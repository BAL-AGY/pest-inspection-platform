import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  enforceRateLimit,
  hashRateLimitIdentifier,
  RATE_LIMIT_POLICIES,
  rateLimitResponse,
  resetRateLimitStore,
  trustedClientAddress,
} from "./rate-limit";

beforeEach(() => {
  resetRateLimitStore();
});

afterEach(() => {
  resetRateLimitStore();
  delete process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS;
});

describe("rate limiting", () => {
  it("allows the configured number of requests then returns an exact retry window", async () => {
    const policy = RATE_LIMIT_POLICIES.booking;
    const now = 1_000_000;
    for (let i = 0; i < policy.limit; i++) {
      const result = await enforceRateLimit({
        policy: "booking",
        companyScope: "company-a",
        identifiers: [{ kind: "lead", value: "lead-a" }],
        now,
      });
      expect(result.allowed).toBe(true);
    }
    const denied = await enforceRateLimit({
      policy: "booking",
      companyScope: "company-a",
      identifiers: [{ kind: "lead", value: "lead-a" }],
      now,
    });
    expect(denied).toEqual({
      allowed: false,
      retryAfterSeconds: policy.windowMs / 1000,
      remaining: 0,
    });
  });

  it("isolates identifiers and company scopes", async () => {
    const policy = RATE_LIMIT_POLICIES.leadCreate;
    for (let i = 0; i < policy.limit + 1; i++) {
      await enforceRateLimit({
        policy: "leadCreate",
        companyScope: "company-a",
        identifiers: [{ kind: "visitor", value: "visitor-a" }],
        now: 1,
      });
    }
    expect(
      await enforceRateLimit({
        policy: "leadCreate",
        companyScope: "company-a",
        identifiers: [{ kind: "visitor", value: "visitor-b" }],
        now: 1,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await enforceRateLimit({
        policy: "leadCreate",
        companyScope: "company-b",
        identifiers: [{ kind: "visitor", value: "visitor-a" }],
        now: 1,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("hashes raw identifiers before they become keys", () => {
    const digest = hashRateLimitIdentifier(["visitor@example.com", "203.0.113.5"]);
    expect(digest).not.toContain("visitor@example.com");
    expect(digest).not.toContain("203.0.113.5");
  });

  it("ignores forwarding headers until a trusted proxy count is configured", () => {
    const req = new NextRequest("http://localhost/api/track", {
      headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.2" },
    });
    expect(trustedClientAddress(req)).toBeNull();
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "1";
    expect(trustedClientAddress(req)).toBe("10.0.0.2");
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "2";
    expect(trustedClientAddress(req)).toBe("198.51.100.9");
  });

  it("rejects invalid proxy trust configuration and insufficient forwarded chains", () => {
    const req = new NextRequest("http://localhost/api/track", {
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "attacker-controlled";
    expect(trustedClientAddress(req)).toBeNull();
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "2";
    expect(trustedClientAddress(req)).toBeNull();
  });

  it("fails closed without exposing backend details when the store is unavailable", async () => {
    const decision = await enforceRateLimit({
      policy: "leadCreate",
      companyScope: "company-a",
      identifiers: [{ kind: "visitor", value: "visitor-a" }],
      store: { consume: async () => { throw new Error("sensitive-backend-detail"); } },
    });
    expect(decision).toMatchObject({ allowed: false, backendUnavailable: true });
    const response = rateLimitResponse(decision);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.text()).not.toContain("sensitive-backend-detail");
  });
});
