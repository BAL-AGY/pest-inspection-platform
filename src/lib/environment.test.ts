import { describe, expect, it } from "vitest";
import {
  assertProductionEnvironment,
  validateProductionEnvironment,
} from "./environment";

const strongEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  AUTH_SECRET: "auth_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe",
  FUNNEL_CAPABILITY_SECRET: "funnel_p2Tz7Jk5Xc9Qn4Vm8Ld1Wr6Hs3Ay0BgF",
  RATE_LIMIT_IDENTIFIER_SECRET: "ratelimit_M7kq4Pw9Xs2Fc8Vn5Dz1Ha6Rj3Te0LuB",
  REDIS_URL: "rediss://redis.internal.example:6379",
  COMMUNICATION_PROVIDER: "disabled",
  COMMUNICATION_JOB_SECRET: "job_4Vq8Nr2Xm7Ka9Ls1Dp6Tw3Hy5Bc0FzEe",
});

describe("production environment validation", () => {
  it.each(["AUTH_SECRET", "FUNNEL_CAPABILITY_SECRET", "COMMUNICATION_JOB_SECRET"] as const)(
    "rejects missing %s",
    (name) => {
      const env = strongEnvironment();
      delete env[name];
      expect(validateProductionEnvironment(env)).toContain(`${name} is required in production`);
    },
  );

  it.each(["AUTH_SECRET", "FUNNEL_CAPABILITY_SECRET", "COMMUNICATION_JOB_SECRET"] as const)(
    "rejects weak or placeholder %s",
    (name) => {
      const env = strongEnvironment();
      env[name] = "replace-with-a-real-secret";
      expect(validateProductionEnvironment(env).join(" ")).toContain(name);
    },
  );

  it("requires the rate-limit identifier secret in production", () => {
    const env = strongEnvironment();
    delete env.RATE_LIMIT_IDENTIFIER_SECRET;
    expect(validateProductionEnvironment(env).join(" ")).toContain(
      "RATE_LIMIT_IDENTIFIER_SECRET",
    );
  });

  it("requires a valid Redis URL in production", () => {
    const missing = strongEnvironment();
    delete missing.REDIS_URL;
    expect(validateProductionEnvironment(missing)).toContain("REDIS_URL is required in production");

    const invalid = strongEnvironment();
    invalid.REDIS_URL = "https://redis.example";
    expect(validateProductionEnvironment(invalid)).toContain(
      "REDIS_URL must use the redis: or rediss: protocol",
    );
  });

  it("fails closed unless a supported production communication provider is explicit", () => {
    const missing = strongEnvironment();
    delete missing.COMMUNICATION_PROVIDER;
    expect(validateProductionEnvironment(missing)).toContain(
      "COMMUNICATION_PROVIDER is required in production",
    );
    const simulated = strongEnvironment();
    simulated.COMMUNICATION_PROVIDER = "deterministic";
    expect(validateProductionEnvironment(simulated)).toContain(
      "COMMUNICATION_PROVIDER is not supported by this build",
    );
  });

  it("rejects reuse between every independent security-secret pair", () => {
    const env = strongEnvironment();
    env.FUNNEL_CAPABILITY_SECRET = env.AUTH_SECRET;
    env.RATE_LIMIT_IDENTIFIER_SECRET = env.AUTH_SECRET;
    const errors = validateProductionEnvironment(env).join(" ");
    expect(errors).toContain("AUTH_SECRET and FUNNEL_CAPABILITY_SECRET");
    expect(errors).toContain("AUTH_SECRET and RATE_LIMIT_IDENTIFIER_SECRET");
  });

  it("accepts independent strong production secrets", () => {
    expect(() => assertProductionEnvironment(strongEnvironment())).not.toThrow();
  });

  it("does not impose production requirements on development/test", () => {
    expect(validateProductionEnvironment({ NODE_ENV: "test" })).toEqual([]);
  });
});
