import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit";
import { RedisRateLimitStore } from "./redis-rate-limit";

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;
const prefix = `pest-inspection:test:${crypto.randomUUID()}:`;
let instanceA: RedisRateLimitStore;
let instanceB: RedisRateLimitStore;

describeRedis("Redis distributed rate limiting", () => {
  beforeAll(() => {
    instanceA = new RedisRateLimitStore(redisUrl!, prefix);
    instanceB = new RedisRateLimitStore(redisUrl!, prefix);
  });

  afterAll(async () => {
    await Promise.all([instanceA.close(), instanceB.close()]);
  });

  it("atomically enforces one limit across concurrent application instances", async () => {
    const policy = RATE_LIMIT_POLICIES.booking;
    const company = `atomic-${crypto.randomUUID()}`;
    const attempts = await Promise.all(
      Array.from({ length: policy.limit * 3 }, (_, index) =>
        enforceRateLimit({
          policy: "booking",
          companyScope: company,
          identifiers: [{ kind: "lead", value: "same-lead" }],
          store: index % 2 === 0 ? instanceA : instanceB,
        }),
      ),
    );

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(policy.limit);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(policy.limit * 2);
    expect(attempts.every((attempt) => attempt.retryAfterSeconds > 0)).toBe(true);
  });

  it("keeps identifiers, companies, and endpoint policies isolated", async () => {
    const company = `isolation-${crypto.randomUUID()}`;
    for (let index = 0; index < RATE_LIMIT_POLICIES.leadCreate.limit + 1; index += 1) {
      await enforceRateLimit({
        policy: "leadCreate",
        companyScope: company,
        identifiers: [{ kind: "visitor", value: "visitor-a" }],
        store: index % 2 === 0 ? instanceA : instanceB,
      });
    }

    await expect(enforceRateLimit({
      policy: "leadCreate",
      companyScope: company,
      identifiers: [{ kind: "visitor", value: "visitor-a" }],
      store: instanceB,
    })).resolves.toMatchObject({ allowed: false });
    await expect(enforceRateLimit({
      policy: "leadCreate",
      companyScope: company,
      identifiers: [{ kind: "visitor", value: "visitor-b" }],
      store: instanceB,
    })).resolves.toMatchObject({ allowed: true });
    await expect(enforceRateLimit({
      policy: "track",
      companyScope: company,
      identifiers: [{ kind: "visitor", value: "visitor-a" }],
      store: instanceB,
    })).resolves.toMatchObject({ allowed: true });
    await expect(enforceRateLimit({
      policy: "booking",
      companyScope: company,
      identifiers: [{ kind: "lead", value: "visitor-a" }],
      store: instanceA,
    })).resolves.toMatchObject({ allowed: true });
    await expect(enforceRateLimit({
      policy: "leadCreate",
      companyScope: `${company}-other`,
      identifiers: [{ kind: "visitor", value: "visitor-a" }],
      store: instanceB,
    })).resolves.toMatchObject({ allowed: true });
  });

  it("uses Redis TTL for Retry-After across instances", async () => {
    const company = `retry-${crypto.randomUUID()}`;
    const policy = RATE_LIMIT_POLICIES.leadCreate;
    const results = [];
    for (let index = 0; index <= policy.limit; index += 1) {
      results.push(await enforceRateLimit({
        policy: "leadCreate",
        companyScope: company,
        identifiers: [{ kind: "visitor", value: "visitor-a" }],
        store: index % 2 === 0 ? instanceA : instanceB,
      }));
    }
    const denied = results.at(-1)!;
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(policy.windowMs / 1000);
  });
});
