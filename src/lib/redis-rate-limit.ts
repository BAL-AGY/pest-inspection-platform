import { createClient, type RedisClientType } from "redis";
import type { RateLimitStore, RateLimitStoreInput, RateLimitStoreResult } from "./rate-limit";

const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local serverTime = redis.call("TIME")
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
return { count, nowMs + ttl }
`;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisClientType;
  private connectPromise: Promise<unknown> | null = null;

  constructor(
    redisUrl: string,
    private readonly keyPrefix = "pest-inspection:rate-limit:v1:",
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: false,
      },
    });
    // A listener is required by node-redis. Request handling reports failures
    // without logging the URL, keys, or raw identifiers.
    this.client.on("error", () => undefined);
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }

  async consume(input: RateLimitStoreInput): Promise<RateLimitStoreResult> {
    await this.ensureConnected();
    const result = await this.client.eval(CONSUME_SCRIPT, {
      keys: [`${this.keyPrefix}${input.key}`],
      arguments: [String(input.windowMs)],
    });
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error("Redis rate-limit script returned an invalid result");
    }

    const count = Number(result[0]);
    const resetAt = Number(result[1]);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(resetAt)) {
      throw new Error("Redis rate-limit script returned invalid counters");
    }

    return {
      allowed: count <= input.limit,
      remaining: Math.max(0, input.limit - count),
      resetAt,
    };
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}
