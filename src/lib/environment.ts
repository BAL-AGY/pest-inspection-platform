const MIN_SECRET_LENGTH = 32;

const KNOWN_WEAK_SECRET_VALUES = new Set([
  "changeme",
  "changeme123",
  "change-me",
  "default",
  "development",
  "example",
  "password",
  "replace-me",
  "replace-with-a-real-secret",
  "secret",
  "test",
]);

export const PRODUCTION_SECRET_NAMES = [
  "AUTH_SECRET",
  "FUNNEL_CAPABILITY_SECRET",
  "RATE_LIMIT_IDENTIFIER_SECRET",
  "COMMUNICATION_JOB_SECRET",
] as const;

export type ProductionSecretName = (typeof PRODUCTION_SECRET_NAMES)[number];

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function secretValidationError(name: string, value: string | undefined): string | null {
  if (!value?.trim()) return `${name} is required in production`;

  const candidate = normalized(value);
  if (
    value.length < MIN_SECRET_LENGTH ||
    KNOWN_WEAK_SECRET_VALUES.has(candidate) ||
    candidate.includes("replace-with") ||
    candidate.includes("generate-a") ||
    candidate.includes("generate-an") ||
    candidate.includes("changeme") ||
    candidate.includes("your-secret") ||
    candidate.includes("example-secret")
  ) {
    return `${name} must be a strong, randomly generated secret of at least ${MIN_SECRET_LENGTH} characters`;
  }

  return null;
}

export function validateProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== "production") return [];

  const errors = PRODUCTION_SECRET_NAMES.flatMap((name) => {
    const error = secretValidationError(name, env[name]);
    return error ? [error] : [];
  });

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    errors.push("DATABASE_URL is required in production");
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        errors.push("DATABASE_URL must use the postgresql: or postgres: protocol");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL URL");
    }
  }

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    errors.push("REDIS_URL is required in production");
  } else {
    try {
      const parsed = new URL(redisUrl);
      if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
        errors.push("REDIS_URL must use the redis: or rediss: protocol");
      }
    } catch {
      errors.push("REDIS_URL must be a valid Redis URL");
    }
  }

  const communicationProvider = env.COMMUNICATION_PROVIDER?.trim();
  if (!communicationProvider) {
    errors.push("COMMUNICATION_PROVIDER is required in production");
  } else if (communicationProvider !== "disabled") {
    errors.push("COMMUNICATION_PROVIDER is not supported by this build");
  }


  const trustedProxyHops = env.RATE_LIMIT_TRUSTED_PROXY_HOPS?.trim();
  if (trustedProxyHops) {
    const parsed = Number(trustedProxyHops);
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.push("RATE_LIMIT_TRUSTED_PROXY_HOPS must be a positive integer when configured");
    }
  }

  for (let left = 0; left < PRODUCTION_SECRET_NAMES.length; left += 1) {
    for (let right = left + 1; right < PRODUCTION_SECRET_NAMES.length; right += 1) {
      const leftName = PRODUCTION_SECRET_NAMES[left];
      const rightName = PRODUCTION_SECRET_NAMES[right];
      const leftValue = env[leftName]?.trim();
      const rightValue = env[rightName]?.trim();
      if (leftValue && rightValue && leftValue === rightValue) {
        errors.push(`${leftName} and ${rightName} must be independent secrets`);
      }
    }
  }

  return errors;
}

export function assertProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const errors = validateProductionEnvironment(env);
  if (errors.length > 0) {
    throw new Error(
      `Invalid production security configuration: ${errors.join("; ")}. Refusing to start.`,
    );
  }
}
