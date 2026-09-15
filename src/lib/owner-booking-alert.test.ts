import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerAlertTwilioProvider, sendOwnerBookingAlert } from "./owner-booking-alert";
import { sendIfAllowed } from "./suppression";

vi.mock("./suppression", () => ({ sendIfAllowed: vi.fn() }));

const booking = {
  appointment: { id: "appointment-1", scheduledStart: new Date("2026-09-16T15:00:00Z"), isDemo: false },
  company: { id: "company-1", slug: "pest-company", timezone: "America/Chicago" },
  lead: { id: "lead-1", firstName: "Jane", lastName: "Doe" },
};

beforeEach(() => {
  vi.stubEnv("OWNER_BOOKING_SMS_ENABLED", "true");
  vi.stubEnv("OWNER_BOOKING_SMS_INCLUDE_DEMO", "false");
  vi.stubEnv("OWNER_BOOKING_SMS_COMPANY_SLUG", "pest-company");
  vi.stubEnv("OWNER_BOOKING_SMS_TO", "+15555550101");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+15555550102");
  vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"a".repeat(32)}`);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("AUTH_URL", "https://pest.example.com");
  vi.mocked(sendIfAllowed).mockResolvedValue({ accepted: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("owner booking alerts", () => {
  it("uses only the configured owner, company timezone, and a stable dedupe key", async () => {
    await sendOwnerBookingAlert(booking);
    expect(sendIfAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+15555550101", body: expect.stringContaining("10:00 AM CDT") }),
      expect.objectContaining({
        type: "owner_booking_alert", dedupeKey: "appointment:appointment-1:owner-booking:sms",
        consent: { emailConsent: false, smsConsent: true, optedOutAt: null },
      }),
    );
    expect(vi.mocked(sendIfAllowed).mock.calls[0][0].body).toContain("https://pest.example.com/dashboard/leads/lead-1");
  });
  it("skips disabled, other-company, and demo bookings", async () => {
    vi.stubEnv("OWNER_BOOKING_SMS_ENABLED", "false");
    await sendOwnerBookingAlert(booking);
    vi.stubEnv("OWNER_BOOKING_SMS_ENABLED", "true");
    await sendOwnerBookingAlert({ ...booking, company: { ...booking.company, slug: "other" } });
    await sendOwnerBookingAlert({ ...booking, appointment: { ...booking.appointment, isDemo: true } });
    expect(sendIfAllowed).not.toHaveBeenCalled();
  });
  it("rejects multiple recipients and incomplete credentials", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OWNER_BOOKING_SMS_TO", "+15555550101,+15555550102");
    await sendOwnerBookingAlert(booking);
    vi.stubEnv("OWNER_BOOKING_SMS_TO", "+15555550101");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    await sendOwnerBookingAlert(booking);
    expect(sendIfAllowed).not.toHaveBeenCalled();
  });
  it("allows demo bookings only with the explicit owner setting", async () => {
    vi.stubEnv("OWNER_BOOKING_SMS_INCLUDE_DEMO", "true");
    await sendOwnerBookingAlert({ ...booking, appointment: { ...booking.appointment, isDemo: true } });
    expect(sendIfAllowed).toHaveBeenCalledOnce();
  });
  it("isolates communication failures from the booking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendIfAllowed).mockRejectedValue(new Error("database unavailable"));
    await expect(sendOwnerBookingAlert(booking)).resolves.toBeUndefined();
  });
});

describe("owner Twilio adapter", () => {
  const provider = new OwnerAlertTwilioProvider({ sid: `AC${"a".repeat(32)}`, token: "secret", from: "+15555550102" });
  const input = { message: { channel: "sms" as const, to: "+15555550101", body: "New booking" }, idempotencyKey: "booking-1" };
  it("posts encoded SMS and records provider acceptance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider.send(input)).resolves.toEqual({ accepted: true, providerMessageId: "SM123" });
    const options = fetchMock.mock.calls[0][1];
    expect(options.body.get("To")).toBe("+15555550101");
    expect(options.body.get("From")).toBe("+15555550102");
    expect(options.body.get("Body")).toBe("New booking");
  });
  it("reports rejection without exposing provider response content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive detail", { status: 400 })));
    await expect(provider.send(input)).resolves.toEqual({ accepted: false, reason: "Twilio HTTP 400" });
  });
});
