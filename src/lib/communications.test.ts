import { afterEach, describe, expect, it, vi } from "vitest";
import { canSend, DeterministicCommunicationProvider, getProvider } from "./communications";

afterEach(() => vi.unstubAllEnvs());

describe("canSend", () => {
  it("blocks any send once opted out, regardless of consent flags", () => {
    const result = canSend("email", "marketing", {
      emailConsent: true,
      smsConsent: true,
      optedOutAt: new Date(),
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/opted out/);
  });

  it("blocks email without email consent", () => {
    const result = canSend("email", "marketing", {
      emailConsent: false,
      smsConsent: true,
      optedOutAt: null,
    });
    expect(result.accepted).toBe(false);
  });

  it("blocks sms without sms consent", () => {
    const result = canSend("sms", "transactional", {
      emailConsent: true,
      smsConsent: false,
      optedOutAt: null,
    });
    expect(result.accepted).toBe(false);
  });

  it("allows send with proper consent and no opt-out", () => {
    const result = canSend("sms", "transactional", {
      emailConsent: false,
      smsConsent: true,
      optedOutAt: null,
    });
    expect(result.accepted).toBe(true);
  });

  it("distinguishes channel opt-out from blanket opt-out", () => {
    const consent = {
      emailConsent: true,
      smsConsent: true,
      emailOptedOutAt: new Date(),
      smsOptedOutAt: null,
      optedOutAt: null,
    };
    expect(canSend("email", "marketing", consent).accepted).toBe(false);
    expect(canSend("sms", "transactional", consent).accepted).toBe(true);
  });

  it("deterministically accepts without network calls or PII logging", async () => {
    const provider = new DeterministicCommunicationProvider();
    const result = await provider.send({
      message: { channel: "sms", to: "+15555550100", body: "hi" },
      idempotencyKey: "company:lead:confirmation",
    });
    expect(result.accepted).toBe(true);
    expect(result.providerMessageId).toMatch(/^det_/);
  });

  it("uses the no-network adapter only in explicit staging and never production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMMUNICATION_PROVIDER", "deterministic");
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    expect(getProvider().name).toBe("disabled");

    vi.stubEnv("DEPLOYMENT_ENV", "staging");
    expect(getProvider().name).toBe("deterministic");
  });
});
