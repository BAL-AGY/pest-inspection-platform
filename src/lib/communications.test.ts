import { describe, expect, it, vi } from "vitest";
import { canSend, sendIfConsented, setProvider } from "./communications";

describe("canSend", () => {
  it("blocks any send once opted out, regardless of consent flags", () => {
    const result = canSend("email", {
      emailConsent: true,
      smsConsent: true,
      optedOutAt: new Date(),
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/opted out/);
  });

  it("blocks email without email consent", () => {
    const result = canSend("email", {
      emailConsent: false,
      smsConsent: true,
      optedOutAt: null,
    });
    expect(result.sent).toBe(false);
  });

  it("blocks sms without sms consent", () => {
    const result = canSend("sms", {
      emailConsent: true,
      smsConsent: false,
      optedOutAt: null,
    });
    expect(result.sent).toBe(false);
  });

  it("allows send with proper consent and no opt-out", () => {
    const result = canSend("sms", {
      emailConsent: false,
      smsConsent: true,
      optedOutAt: null,
    });
    expect(result.sent).toBe(true);
  });
});

describe("sendIfConsented", () => {
  it("never calls the provider when consent is missing", async () => {
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfConsented(
      { channel: "sms", to: "+15555550100", body: "hi" },
      { emailConsent: false, smsConsent: false, optedOutAt: null },
    );

    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("calls the provider when consent is present", async () => {
    const send = vi.fn().mockResolvedValue({ sent: true });
    setProvider({ send });

    const result = await sendIfConsented(
      { channel: "sms", to: "+15555550100", body: "hi" },
      { emailConsent: false, smsConsent: true, optedOutAt: null },
    );

    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
