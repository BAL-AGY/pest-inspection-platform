import { describe, expect, it } from "vitest";
import { homeownerApiError, readJsonObject } from "./http-response";

describe("homeowner API response handling", () => {
  it("parses valid JSON responses", async () => {
    const response = Response.json({ lead: { id: "lead-1" } });
    await expect(readJsonObject(response)).resolves.toEqual({ lead: { id: "lead-1" } });
  });

  it.each([
    new Response(null, { status: 500 }),
    new Response("upstream failure", { status: 502, headers: { "content-type": "text/plain" } }),
    new Response("{", { status: 500, headers: { "content-type": "application/json" } }),
  ])("safely handles empty, non-JSON, and malformed responses", async (response) => {
    await expect(readJsonObject(response)).resolves.toBeNull();
  });

  it("uses clean status-specific messages without exposing server content", () => {
    const response = new Response(null, { status: 500 });
    expect(homeownerApiError(response, { reason: "database password leaked" })).toBe(
      "We couldn't save your information right now. Please try again in a moment.",
    );
    expect(homeownerApiError(new Response(null, { status: 429 }), null)).toMatch(/too many/i);
    expect(homeownerApiError(new Response(null, { status: 403 }), null)).toMatch(/session/i);
  });
});
