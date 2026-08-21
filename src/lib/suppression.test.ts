import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({
  prisma: {
    suppressionEntry: { count: vi.fn(), upsert: vi.fn() },
    communicationProviderAccount: { findFirst: vi.fn() },
    communication: { create: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    funnelEvent: { create: vi.fn() },
  },
}));

import { prisma } from "./prisma";
import { setProvider } from "./communications";
import {
  isSuppressed,
  normalizeEmail,
  normalizePhone,
  recordSuppression,
  sendIfAllowed,
} from "./suppression";

const db = prisma as unknown as {
  suppressionEntry: { count: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  communicationProviderAccount: { findFirst: ReturnType<typeof vi.fn> };
  communication: {
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  funnelEvent: { create: ReturnType<typeof vi.fn> };
};

const params = {
  companyId: "company-a",
  leadId: "lead-a",
  appointmentId: "appointment-a",
  type: "appointment_confirmation" as const,
  purpose: "transactional" as const,
  dedupeKey: "appointment-a:confirmation:email",
};

describe("communication normalization and suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProvider(null);
  });

  it("normalizes contact identifiers without unsafe mailbox alias merging", () => {
    expect(normalizeEmail(" User+tag@Example.COM ")).toBe("user+tag@example.com");
    expect(normalizePhone("+1 (512) 555-0100")).toBe("5125550100");
  });

  it("scopes suppression by tenant, channel, and communication purpose", async () => {
    db.suppressionEntry.count.mockResolvedValue(1);
    await expect(isSuppressed({
      companyId: "company-a",
      channel: "email",
      email: "User@Example.com",
      purpose: "transactional",
    })).resolves.toBe(true);
    expect(db.suppressionEntry.count).toHaveBeenCalledWith({
      where: {
        companyId: "company-a",
        channel: { in: ["email", "all"] },
        scope: { in: ["all"] },
        OR: [{ identifierType: "email", identifierValue: "user@example.com" }],
      },
    });
  });

  it("records an idempotent channel suppression with provenance", async () => {
    await recordSuppression({
      companyId: "company-a",
      channel: "sms",
      phone: "+1 512 555 0100",
      scope: "all",
      reason: "provider_opt_out",
      source: "provider_webhook",
    });
    expect(db.suppressionEntry.upsert.mock.calls[0][0].create).toMatchObject({
      companyId: "company-a",
      channel: "sms",
      scope: "all",
      identifierValue: "5125550100",
      source: "provider_webhook",
    });
  });
});

describe("sendIfAllowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.communicationProviderAccount.findFirst.mockResolvedValue(null);
    db.communication.create.mockImplementation(({ data }) => Promise.resolve({ id: "comm-a", ...data }));
    db.communication.createMany.mockResolvedValue({ count: 1 });
    db.communication.findUniqueOrThrow.mockResolvedValue({ id: "comm-a", status: "attempted", providerMessageId: null });
    db.communication.update.mockResolvedValue({});
    db.funnelEvent.create.mockResolvedValue({});
  });

  it("never invokes the provider when consent is denied", async () => {
    db.suppressionEntry.count.mockResolvedValue(0);
    const send = vi.fn();
    setProvider({ name: "test", send });
    const result = await sendIfAllowed(
      { channel: "email", to: "user@example.com", body: "confirmation" },
      { ...params, consent: { emailConsent: false, smsConsent: false, optedOutAt: null } },
    );
    expect(result.accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(db.communication.create.mock.calls[0][0].data.status).toBe("blocked");
  });

  it("records suppression without invoking the provider", async () => {
    db.suppressionEntry.count.mockResolvedValue(1);
    const send = vi.fn();
    setProvider({ name: "test", send });
    const result = await sendIfAllowed(
      { channel: "email", to: "user@example.com", body: "confirmation" },
      { ...params, consent: { emailConsent: true, smsConsent: false, optedOutAt: null } },
    );
    expect(result.accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(db.communication.create.mock.calls[0][0].data.status).toBe("suppressed");
  });

  it("reserves an attempt before provider acceptance and records accepted, not delivered", async () => {
    db.suppressionEntry.count.mockResolvedValue(0);
    const send = vi.fn().mockResolvedValue({ accepted: true, providerMessageId: "provider-1" });
    setProvider({ name: "test", send });
    const result = await sendIfAllowed(
      { channel: "email", to: "user@example.com", body: "confirmation" },
      { ...params, consent: { emailConsent: true, smsConsent: false, optedOutAt: null } },
    );
    expect(result.accepted).toBe(true);
    expect(db.communication.createMany.mock.calls[0][0].data[0].status).toBe("attempted");
    expect(db.communication.update.mock.calls[0][0].data).toMatchObject({
      status: "accepted",
      providerMessageId: "provider-1",
    });
    expect(db.communication.update.mock.calls[0][0].data.status).not.toBe("delivered");
  });

  it("records a sanitized failure when the provider is unavailable", async () => {
    db.suppressionEntry.count.mockResolvedValue(0);
    setProvider({ name: "test", send: vi.fn().mockRejectedValue(new Error("secret provider detail")) });
    const result = await sendIfAllowed(
      { channel: "sms", to: "5125550100", body: "confirmation" },
      {
        ...params,
        dedupeKey: "appointment-a:confirmation:sms",
        consent: { emailConsent: false, smsConsent: true, optedOutAt: null },
      },
    );
    expect(result.accepted).toBe(false);
    expect(db.communication.update.mock.calls[0][0].data.failureReason).toBe("Provider request failed");
  });
});
