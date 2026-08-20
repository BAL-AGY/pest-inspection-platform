import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./prisma", () => ({
  prisma: {
    suppressionEntry: {
      count: vi.fn(),
      upsert: vi.fn(),
    },
    communication: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";
import {
  normalizeEmail,
  normalizePhone,
  isSuppressed,
  recordSuppression,
  suppressedChannels,
  sendIfAllowed,
} from "./suppression";
import { setProvider } from "./communications";

const count = prisma.suppressionEntry.count as unknown as ReturnType<typeof vi.fn>;
const upsert = prisma.suppressionEntry.upsert as unknown as ReturnType<typeof vi.fn>;
const communicationCreate = prisma.communication.create as unknown as ReturnType<typeof vi.fn>;

describe("normalizeEmail", () => {
  it("trims and lowercases for comparison", () => {
    expect(normalizeEmail("  Jordan.Rivers@Example.COM ")).toBe("jordan.rivers@example.com");
  });

  it("does not merge dot/plus-tag variants — avoids aggressive normalization that could merge distinct addresses", () => {
    expect(normalizeEmail("user+newsletter@example.com")).toBe("user+newsletter@example.com");
    expect(normalizeEmail("u.ser@example.com")).toBe("u.ser@example.com");
    expect(normalizeEmail("user@example.com")).not.toBe(normalizeEmail("u.ser@example.com"));
  });
});

describe("normalizePhone", () => {
  it("strips formatting punctuation to bare digits", () => {
    expect(normalizePhone("(512) 555-0100")).toBe("5125550100");
  });

  it("strips a leading US/Canada country code so equivalent numbers match", () => {
    expect(normalizePhone("+1 512 555 0100")).toBe("5125550100");
    expect(normalizePhone("15125550100")).toBe("5125550100");
    expect(normalizePhone("+15125550100")).toBe(normalizePhone("(512) 555-0100"));
  });
});

describe("isSuppressed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks channel-specific and blanket 'all' entries, scoped to the company", async () => {
    count.mockResolvedValue(1);
    const result = await isSuppressed({ companyId: "company-a", channel: "email", email: "Jordan@Example.com" });
    expect(result).toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: {
        companyId: "company-a",
        channel: { in: ["email", "all"] },
        OR: [{ identifierType: "email", identifierValue: "jordan@example.com" }],
      },
    });
  });

  it("returns false without querying when no identifiers are given", async () => {
    const result = await isSuppressed({ companyId: "company-a", channel: "sms" });
    expect(result).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  it("scopes strictly by companyId — a match never leaks across tenants", async () => {
    count.mockResolvedValue(0);
    const result = await isSuppressed({ companyId: "company-b", channel: "email", email: "jordan@example.com" });
    expect(result).toBe(false);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-b" }) }),
    );
  });
});

describe("suppressedChannels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports each channel independently", async () => {
    count.mockImplementation(({ where }: { where: { channel: { in: string[] } } }) =>
      Promise.resolve(where.channel.in.includes("email") ? 1 : 0),
    );
    const result = await suppressedChannels({
      companyId: "company-a",
      email: "jordan@example.com",
      phone: "5125550100",
    });
    expect(result).toEqual({ email: true, sms: false });
  });

  it("skips channels with no identifier at all", async () => {
    const result = await suppressedChannels({ companyId: "company-a", email: null, phone: null });
    expect(result).toEqual({ email: false, sms: false });
    expect(count).not.toHaveBeenCalled();
  });
});

describe("recordSuppression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists an email opt-out", async () => {
    await recordSuppression({
      companyId: "company-a",
      channel: "all",
      email: "Jordan@Example.com",
      reason: "opted_out",
      source: "crm_manual_optout",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      companyId: "company-a",
      channel: "all",
      identifierType: "email",
      identifierValue: "jordan@example.com",
      reason: "opted_out",
      source: "crm_manual_optout",
    });
  });

  it("persists an sms/phone opt-out", async () => {
    await recordSuppression({
      companyId: "company-a",
      channel: "all",
      phone: "+1 (512) 555-0100",
      reason: "opted_out",
      source: "crm_manual_optout",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      identifierType: "phone",
      identifierValue: "5125550100",
    });
  });

  it("persists one entry per identifier when both are present", async () => {
    await recordSuppression({
      companyId: "company-a",
      channel: "all",
      email: "a@example.com",
      phone: "5125550100",
      reason: "opted_out",
      source: "crm_manual_optout",
    });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

describe("sendIfAllowed — the shared communication gate", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseParams = {
    companyId: "company-a",
    leadId: "lead-1",
    appointmentId: "appt-1",
    type: "appointment_confirmation" as const,
  };

  it("rejects a suppressed contact without ever invoking the provider, and persists a BLOCKED record", async () => {
    count.mockResolvedValue(1);
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "email", to: "jordan@example.com", body: "hi" },
      { ...baseParams, consent: { emailConsent: true, smsConsent: true, optedOutAt: null } },
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/suppress/);
    expect(send).not.toHaveBeenCalled();

    expect(communicationCreate).toHaveBeenCalledTimes(1);
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      companyId: "company-a",
      leadId: "lead-1",
      appointmentId: "appt-1",
      channel: "email",
      type: "appointment_confirmation",
      to: "jordan@example.com",
      status: "blocked",
      blockedReason: expect.stringMatching(/suppress/),
    });
  });

  it("allows a non-suppressed, consented email contact through to the provider and records SENT", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "email", to: "jordan@example.com", body: "hi" },
      { ...baseParams, consent: { emailConsent: true, smsConsent: false, optedOutAt: null } },
    );

    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      companyId: "company-a",
      leadId: "lead-1",
      channel: "email",
      status: "sent",
    });
  });

  it("allows a non-suppressed, consented SMS contact through to the provider and records SENT", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "sms", to: "5125550100", body: "hi" },
      { ...baseParams, consent: { emailConsent: false, smsConsent: true, optedOutAt: null } },
    );

    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      channel: "sms",
      to: "5125550100",
      status: "sent",
    });
  });

  it("still enforces per-lead consent even when not suppressed, and persists a BLOCKED record with the consent reason", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "email", to: "jordan@example.com", body: "hi" },
      { ...baseParams, consent: { emailConsent: false, smsConsent: false, optedOutAt: null } },
    );

    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      status: "blocked",
      blockedReason: expect.stringMatching(/consent/),
    });
  });

  it("records a FAILED communication when the provider throws", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockRejectedValue(new Error("network timeout"));
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "email", to: "jordan@example.com", body: "hi" },
      { ...baseParams, consent: { emailConsent: true, smsConsent: false, optedOutAt: null } },
    );

    expect(result.sent).toBe(false);
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      failureReason: "network timeout",
    });
  });

  it("records a FAILED communication when the provider resolves sent:false without throwing", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ sent: false, reason: "invalid phone number" });
    setProvider({ send });

    const result = await sendIfAllowed(
      { channel: "sms", to: "5125550100", body: "hi" },
      { ...baseParams, consent: { emailConsent: false, smsConsent: true, optedOutAt: null } },
    );

    expect(result.sent).toBe(false);
    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      failureReason: "invalid phone number",
    });
  });

  it("scopes each communication record to the correct company and lead", async () => {
    count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    await sendIfAllowed(
      { channel: "email", to: "jordan@example.com", body: "hi" },
      {
        companyId: "company-b",
        leadId: "lead-42",
        appointmentId: "appt-42",
        type: "appointment_rescheduled",
        consent: { emailConsent: true, smsConsent: false, optedOutAt: null },
      },
    );

    expect(communicationCreate.mock.calls[0][0].data).toMatchObject({
      companyId: "company-b",
      leadId: "lead-42",
      appointmentId: "appt-42",
      type: "appointment_rescheduled",
    });
  });
});
