import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertProductionEnvironment } from "./environment";
import { RedisRateLimitStore } from "./redis-rate-limit";

export const RATE_LIMIT_POLICIES = {
  leadCreate: { limit: 6, windowMs: 60 * 60_000, globalLimit: 300 },
  leadContinue: { limit: 30, windowMs: 10 * 60_000, globalLimit: 1_000 },
  track: { limit: 120, windowMs: 60_000, globalLimit: 5_000 },
  availability: { limit: 40, windowMs: 5 * 60_000, globalLimit: 2_000 },
  booking: { limit: 12, windowMs: 15 * 60_000, globalLimit: 300 },
  auth: { limit: 10, windowMs: 15 * 60_000, globalLimit: 300 },
  communicationWebhook: { limit: 600, windowMs: 60_000, globalLimit: 5_000 },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitStoreInput {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}

export interface RateLimitStoreResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Storage boundary shared by the local in-memory and production Redis stores. */
export interface RateLimitStore {
  consume(input: RateLimitStoreInput): Promise<RateLimitStoreResult>;
}

interface Counter {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();

  async consume(input: RateLimitStoreInput): Promise<RateLimitStoreResult> {
    const prior = this.counters.get(input.key);
    const counter = !prior || prior.resetAt <= input.now
      ? { count: 0, resetAt: input.now + input.windowMs }
      : prior;

    counter.count += 1;
    this.counters.set(input.key, counter);

    // Opportunistic bounded cleanup. The store is deliberately simple for
    // one-process development; production must replace it with a shared store.
    if (this.counters.size > 10_000) {
      for (const [key, value] of this.counters) {
        if (value.resetAt <= input.now) this.counters.delete(key);
      }
    }

    return {
      allowed: counter.count <= input.limit,
      remaining: Math.max(0, input.limit - counter.count),
      resetAt: counter.resetAt,
    };
  }

  clear() {
    this.counters.clear();
  }
}

const memoryStore = new InMemoryRateLimitStore();
let activeStore: RateLimitStore | null = null;
let configuredRedisStore: { url: string; store: RedisRateLimitStore } | null = null;
const processSalt = crypto.randomBytes(32);

export function setRateLimitStore(store: RateLimitStore) {
  activeStore = store;
}

export function resetRateLimitStore() {
  memoryStore.clear();
  activeStore = memoryStore;
}

function defaultRateLimitStore(): RateLimitStore {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return memoryStore;
  if (!configuredRedisStore || configuredRedisStore.url !== redisUrl) {
    configuredRedisStore = { url: redisUrl, store: new RedisRateLimitStore(redisUrl) };
  }
  return configuredRedisStore.store;
}

function identifierSecret(): crypto.BinaryLike {
  assertProductionEnvironment();
  return process.env.RATE_LIMIT_IDENTIFIER_SECRET || processSalt;
}

/** Raw identifiers never become store keys or logs; only an HMAC digest does. */
export function hashRateLimitIdentifier(parts: string[]): string {
  return crypto
    .createHmac("sha256", identifierSecret())
    .update(parts.map((part) => `${part.length}:${part}`).join("|"))
    .digest("base64url");
}

/**
 * Resolve a network address only when the operator explicitly configured how
 * many trusted proxies overwrite/append X-Forwarded-For. Without that trust
 * boundary we ignore forwarding headers instead of trusting attacker input.
 */
export function trustedClientAddress(req: NextRequest): string | null {
  const rawHops = process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS;
  if (!rawHops) return null;
  const trustedHops = Number(rawHops);
  if (!Number.isInteger(trustedHops) || trustedHops < 1) return null;

  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const clientIndex = chain.length - trustedHops;
  return clientIndex >= 0 ? chain[clientIndex] : null;
}

export interface RateLimitIdentifier {
  kind: "visitor" | "lead" | "network" | "session";
  value: string | null | undefined;
}

export interface EnforceRateLimitInput {
  policy: RateLimitPolicyName;
  companyScope: string;
  identifiers: RateLimitIdentifier[];
  now?: number;
  /** Explicit injection point used by tests and independently configured instances. */
  store?: RateLimitStore;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  backendUnavailable?: boolean;
}

export async function enforceRateLimit(input: EnforceRateLimitInput): Promise<RateLimitDecision> {
  const policy = RATE_LIMIT_POLICIES[input.policy];
  const now = input.now ?? Date.now();
  const identifiers = input.identifiers.filter(
    (identifier): identifier is RateLimitIdentifier & { value: string } =>
      typeof identifier.value === "string" && identifier.value.length > 0,
  );

  const buckets = [
    ...identifiers.map((identifier) => ({
      key: hashRateLimitIdentifier([
        "rate-limit-v1",
        input.companyScope,
        input.policy,
        identifier.kind,
        identifier.value,
      ]),
      limit: policy.limit,
    })),
    // Per-process emergency ceiling remains useful when no trusted network
    // address is available or attackers rotate visitor IDs.
    {
      key: hashRateLimitIdentifier(["rate-limit-v1", input.companyScope, input.policy, "global"]),
      limit: policy.globalLimit,
    },
  ];

  let results: RateLimitStoreResult[];
  try {
    const store = input.store ?? activeStore ?? defaultRateLimitStore();
    results = await Promise.all(
      buckets.map((bucket) =>
        store.consume({ key: bucket.key, limit: bucket.limit, windowMs: policy.windowMs, now }),
      ),
    );
  } catch {
    return {
      allowed: false,
      retryAfterSeconds: 30,
      remaining: 0,
      backendUnavailable: true,
    };
  }
  const denied = results.filter((result) => !result.allowed);
  const resetAt = Math.max(...(denied.length > 0 ? denied : results).map((result) => result.resetAt));

  return {
    allowed: denied.length === 0,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    remaining: Math.min(...results.map((result) => result.remaining)),
  };
}

export function rateLimitResponse(decision: RateLimitDecision) {
  if (decision.backendUnavailable) {
    return NextResponse.json(
      { error: "rate_limit_unavailable", reason: "Request protection is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  return NextResponse.json(
    { error: "rate_limited", reason: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

export function publicCompanyRateLimitScope(): string {
  return process.env.DEFAULT_COMPANY_SLUG ?? "default-public-company";
}
