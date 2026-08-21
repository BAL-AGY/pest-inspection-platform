import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { DeterministicWebhookAdapter } from "./communication-webhooks";

const secret = "test-webhook-secret-that-is-long-and-random";
const adapter = new DeterministicWebhookAdapter(secret);
const now = new Date("2026-08-20T12:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1000);
const body = JSON.stringify({
  id: "event-1",
  accountId: "account-1",
  type: "delivered",
  channel: "email",
  occurredAt: now.toISOString(),
  messageId: "message-1",
});

function headers(at = timestamp, signingSecret = secret) {
  return new Headers({
    "x-communication-timestamp": String(at),
    "x-communication-signature": crypto.createHmac("sha256", signingSecret).update(`${at}.${body}`).digest("hex"),
  });
}

describe("deterministic webhook verification", () => {
  it("accepts an authentic, recent, schema-valid event", () => {
    expect(adapter.verify({ rawBody: body, headers: headers(), now })).toMatchObject({ id: "event-1" });
  });

  it("rejects forged signatures and altered payloads", () => {
    expect(adapter.verify({ rawBody: body, headers: headers(timestamp, "wrong-secret"), now })).toBeNull();
    expect(adapter.verify({ rawBody: `${body} `, headers: headers(), now })).toBeNull();
  });

  it("rejects expired and future-dated replays", () => {
    expect(adapter.verify({ rawBody: body, headers: headers(timestamp - 301), now })).toBeNull();
    expect(adapter.verify({ rawBody: body, headers: headers(timestamp + 301), now })).toBeNull();
  });
});
