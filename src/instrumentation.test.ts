import { describe, it, expect, afterEach, vi } from "vitest";

describe("instrumentation register()", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalFunnelSecret = process.env.FUNNEL_CAPABILITY_SECRET;
  const originalRateLimitSecret = process.env.RATE_LIMIT_IDENTIFIER_SECRET;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRuntime = process.env.NEXT_RUNTIME;

  function setStrongProductionSecrets() {
    process.env.AUTH_SECRET = "auth_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe";
    process.env.FUNNEL_CAPABILITY_SECRET = "funnel_p2Tz7Jk5Xc9Qn4Vm8Ld1Wr6Hs3Ay0BgF";
    process.env.RATE_LIMIT_IDENTIFIER_SECRET =
      "ratelimit_M7kq4Pw9Xs2Fc8Vn5Dz1Ha6Rj3Te0LuB";
    process.env.REDIS_URL = "rediss://redis.internal.example:6379";
  }

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.FUNNEL_CAPABILITY_SECRET = originalFunnelSecret;
    process.env.RATE_LIMIT_IDENTIFIER_SECRET = originalRateLimitSecret;
    process.env.REDIS_URL = originalRedisUrl;
    process.env.NEXT_RUNTIME = originalRuntime;
    vi.unstubAllEnvs();
  });

  it("throws at startup in production when FUNNEL_CAPABILITY_SECRET is missing", async () => {
    setStrongProductionSecrets();
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    process.env.NEXT_RUNTIME = "nodejs";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/FUNNEL_CAPABILITY_SECRET/);
  });

  it("does not throw at startup in production once all secrets are strong and independent", async () => {
    setStrongProductionSecrets();
    process.env.NEXT_RUNTIME = "nodejs";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not throw outside production even when the secret is missing (dev/test convenience)", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    delete process.env.RATE_LIMIT_IDENTIFIER_SECRET;
    process.env.NEXT_RUNTIME = "nodejs";
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not throw outside the nodejs runtime even in production (e.g. edge)", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    process.env.NEXT_RUNTIME = "edge";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });
});
