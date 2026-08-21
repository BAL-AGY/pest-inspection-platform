import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("funnel-capability", () => {
  const originalSecret = process.env.FUNNEL_CAPABILITY_SECRET;
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalRateLimitSecret = process.env.RATE_LIMIT_IDENTIFIER_SECRET;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalCommunicationProvider = process.env.COMMUNICATION_PROVIDER;
  const originalCommunicationJobSecret = process.env.COMMUNICATION_JOB_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.FUNNEL_CAPABILITY_SECRET = "test-only-secret-value";
  });

  afterEach(() => {
    process.env.FUNNEL_CAPABILITY_SECRET = originalSecret;
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.RATE_LIMIT_IDENTIFIER_SECRET = originalRateLimitSecret;
    process.env.REDIS_URL = originalRedisUrl;
    process.env.COMMUNICATION_PROVIDER = originalCommunicationProvider;
    process.env.COMMUNICATION_JOB_SECRET = originalCommunicationJobSecret;
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
    vi.useRealTimers();
  });

  const params = { companyId: "company-1", leadId: "lead-1", visitorId: "visitor-1" };

  it("issues a token that verifies successfully", async () => {
    const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
    const token = issueLeadToken(params);
    expect(verifyLeadToken({ ...params, token })).toBe(true);
  });

  it("issues tokens that only verify for the exact company/lead/visitor they were issued for", async () => {
    const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
    const token = issueLeadToken(params);
    expect(verifyLeadToken({ ...params, companyId: "company-2", token })).toBe(false);
    expect(verifyLeadToken({ ...params, leadId: "lead-2", token })).toBe(false);
    expect(verifyLeadToken({ ...params, visitorId: "visitor-2", token })).toBe(false);
  });

  it("rejects a missing token", async () => {
    const { verifyLeadToken } = await import("./funnel-capability");
    expect(verifyLeadToken({ ...params, token: null })).toBe(false);
    expect(verifyLeadToken({ ...params, token: undefined })).toBe(false);
    expect(verifyLeadToken({ ...params, token: "" })).toBe(false);
  });

  it("rejects a token issued for a different lead (the actual IDOR case)", async () => {
    // Attacker has a valid token for their OWN lead but targets someone
    // else's leadId/visitorId — verification must recompute the expected
    // token from the server-side (candidate.visitorId), not trust the
    // caller's claimed identity.
    const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
    const attackerToken = issueLeadToken({ companyId: "company-1", leadId: "attacker-lead", visitorId: "attacker-visitor" });
    expect(verifyLeadToken({ ...params, token: attackerToken })).toBe(false);
  });

  it("rejects malformed/garbage tokens", async () => {
    const { verifyLeadToken } = await import("./funnel-capability");
    expect(verifyLeadToken({ ...params, token: "not-a-real-token" })).toBe(false); // no "."
    expect(verifyLeadToken({ ...params, token: "123." })).toBe(false); // empty signature
    expect(verifyLeadToken({ ...params, token: "not-a-number.somesignature" })).toBe(false); // non-numeric iat
    expect(verifyLeadToken({ ...params, token: ".signature" })).toBe(false); // empty iat
  });

  it("rejects a token issued under a different secret (e.g. after rotation)", async () => {
    const { issueLeadToken } = await import("./funnel-capability");
    const token = issueLeadToken(params);
    process.env.FUNNEL_CAPABILITY_SECRET = "a-different-secret";
    vi.resetModules();
    const rotated = await import("./funnel-capability");
    expect(rotated.verifyLeadToken({ ...params, token })).toBe(false);
  });

  it("falls back to AUTH_SECRET in dev/test when FUNNEL_CAPABILITY_SECRET is unset", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    process.env.AUTH_SECRET = "fallback-secret";
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
    const token = issueLeadToken(params);
    expect(verifyLeadToken({ ...params, token })).toBe(true);
  });

  it("throws when neither secret is configured outside production", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    delete process.env.AUTH_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    const { issueLeadToken } = await import("./funnel-capability");
    expect(() => issueLeadToken(params)).toThrow(/secret/i);
  });

  it("in production, requires FUNNEL_CAPABILITY_SECRET and never falls back to AUTH_SECRET", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    process.env.AUTH_SECRET = "some-auth-secret-that-must-not-be-used";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { issueLeadToken } = await import("./funnel-capability");
    expect(() => issueLeadToken(params)).toThrow(/production/i);
  });

  it("in production, issues and verifies tokens normally once FUNNEL_CAPABILITY_SECRET is set", async () => {
    process.env.AUTH_SECRET = "auth_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe";
    process.env.FUNNEL_CAPABILITY_SECRET = "funnel_p2Tz7Jk5Xc9Qn4Vm8Ld1Wr6Hs3Ay0BgF";
    process.env.RATE_LIMIT_IDENTIFIER_SECRET =
      "ratelimit_M7kq4Pw9Xs2Fc8Vn5Dz1Ha6Rj3Te0LuB";
    process.env.REDIS_URL = "rediss://redis.internal.example:6379";
    process.env.COMMUNICATION_PROVIDER = "disabled";
    process.env.COMMUNICATION_JOB_SECRET = "job_4Vq8Nr2Xm7Ka9Ls1Dp6Tw3Hy5Bc0FzEe";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
    const token = issueLeadToken(params);
    expect(verifyLeadToken({ ...params, token })).toBe(true);
  });

  describe("expiry", () => {
    it("accepts a token still within the TTL", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { issueLeadToken, verifyLeadToken, LEAD_TOKEN_TTL_MS } = await import("./funnel-capability");
      const token = issueLeadToken(params);
      vi.setSystemTime(new Date(Date.now() + LEAD_TOKEN_TTL_MS - 1000));
      expect(verifyLeadToken({ ...params, token })).toBe(true);
    });

    it("rejects a token once past the TTL", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { issueLeadToken, verifyLeadToken, LEAD_TOKEN_TTL_MS } = await import("./funnel-capability");
      const token = issueLeadToken(params);
      vi.setSystemTime(new Date(Date.now() + LEAD_TOKEN_TTL_MS + 1000));
      expect(verifyLeadToken({ ...params, token })).toBe(false);
    });

    it("rejects a future-dated token (issuedAt after the current time)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
      const { issueLeadToken, verifyLeadToken } = await import("./funnel-capability");
      const futureToken = issueLeadToken(params);
      // Roll the clock backward relative to when the token claims to have
      // been issued — simulates a tampered/forged future iat.
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      expect(verifyLeadToken({ ...params, token: futureToken })).toBe(false);
    });

    it("a fresh token re-issued on each response effectively slides the expiry window forward", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { issueLeadToken, verifyLeadToken, LEAD_TOKEN_TTL_MS } = await import("./funnel-capability");
      let token = issueLeadToken(params);
      // Advance close to (but not past) the TTL, then "continue the funnel"
      // — re-issuing picks up a fresh iat, extending the window again.
      vi.setSystemTime(new Date(Date.now() + LEAD_TOKEN_TTL_MS - 1000));
      expect(verifyLeadToken({ ...params, token })).toBe(true);
      token = issueLeadToken(params);
      vi.setSystemTime(new Date(Date.now() + LEAD_TOKEN_TTL_MS - 1000));
      expect(verifyLeadToken({ ...params, token })).toBe(true);
    });
  });
});
