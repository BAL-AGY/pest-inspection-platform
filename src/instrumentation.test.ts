import { describe, it, expect, afterEach, vi } from "vitest";

describe("instrumentation register()", () => {
  const originalSecret = process.env.FUNNEL_CAPABILITY_SECRET;
  const originalRuntime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    process.env.FUNNEL_CAPABILITY_SECRET = originalSecret;
    process.env.NEXT_RUNTIME = originalRuntime;
    vi.unstubAllEnvs();
  });

  it("throws at startup in production when FUNNEL_CAPABILITY_SECRET is missing", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
    process.env.NEXT_RUNTIME = "nodejs";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/FUNNEL_CAPABILITY_SECRET/);
  });

  it("does not throw at startup in production once FUNNEL_CAPABILITY_SECRET is set", async () => {
    process.env.FUNNEL_CAPABILITY_SECRET = "a-real-production-secret";
    process.env.NEXT_RUNTIME = "nodejs";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not throw outside production even when the secret is missing (dev/test convenience)", async () => {
    delete process.env.FUNNEL_CAPABILITY_SECRET;
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
