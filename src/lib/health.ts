import { createClient, type RedisClientType } from "redis";
import { prisma } from "./prisma";

export interface ReadinessDependencies {
  checkPostgres: () => Promise<void>;
  checkRedis: () => Promise<void>;
}

export interface ReadinessResult {
  ready: boolean;
  failedChecks: Array<"postgresql" | "redis">;
}

const globalForHealth = globalThis as unknown as {
  redisHealthClient?: RedisClientType;
  redisHealthUrl?: string;
};

function redisHealthClient(): RedisClientType {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("Redis is not configured");
  if (!globalForHealth.redisHealthClient || globalForHealth.redisHealthUrl !== redisUrl) {
    const client = createClient({
      url: redisUrl,
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    client.on("error", () => undefined);
    globalForHealth.redisHealthClient = client;
    globalForHealth.redisHealthUrl = redisUrl;
  }
  return globalForHealth.redisHealthClient;
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Dependency check timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const productionDependencies: ReadinessDependencies = {
  async checkPostgres() {
    await prisma.$queryRaw`SELECT 1`;
  },
  async checkRedis() {
    const client = redisHealthClient();
    if (!client.isReady) await client.connect();
    await client.ping();
  },
};

let cachedReadiness: { expiresAt: number; result: ReadinessResult } | null = null;
let readinessInFlight: Promise<ReadinessResult> | null = null;

export async function checkReadiness(
  dependencies: ReadinessDependencies = productionDependencies,
): Promise<ReadinessResult> {
  const results = await Promise.allSettled([
    within(dependencies.checkPostgres(), 1_500),
    within(dependencies.checkRedis(), 1_500),
  ]);
  const failedChecks: ReadinessResult["failedChecks"] = [];
  if (results[0].status === "rejected") failedChecks.push("postgresql");
  if (results[1].status === "rejected") failedChecks.push("redis");
  return { ready: failedChecks.length === 0, failedChecks };
}

/**
 * Health monitors can poll frequently and the endpoint is public. Coalesce and
 * briefly cache dependency probes per instance so it cannot amplify traffic to
 * PostgreSQL/Redis. The pure injected checker above remains uncached for tests.
 */
export async function checkOperationalReadiness(now = Date.now()): Promise<ReadinessResult> {
  if (cachedReadiness && cachedReadiness.expiresAt > now) return cachedReadiness.result;
  if (!readinessInFlight) {
    readinessInFlight = checkReadiness().then((result) => {
      cachedReadiness = { result, expiresAt: Date.now() + 5_000 };
      return result;
    }).finally(() => {
      readinessInFlight = null;
    });
  }
  return readinessInFlight;
}
