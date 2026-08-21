const MIN_SECRET_LENGTH = 32;

export type DeploymentEnvironment = "development" | "staging" | "production" | "test";

export function deploymentEnvironment(env: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  const configured = env.DEPLOYMENT_ENV?.trim();
  if (configured === "development" || configured === "staging" || configured === "production" || configured === "test") {
    return configured;
  }
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "test";
  return "development";
}

export function isStagingEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return deploymentEnvironment(env) === "staging";
}

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

  const configuredDeploymentEnvironment = env.DEPLOYMENT_ENV?.trim();
  if (configuredDeploymentEnvironment && !["staging", "production"].includes(configuredDeploymentEnvironment)) {
    errors.push("DEPLOYMENT_ENV must be staging or production when NODE_ENV is production");
  }
  const deployment = deploymentEnvironment(env);

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

  const authUrl = env.AUTH_URL?.trim();
  if (!authUrl) {
    errors.push("AUTH_URL is required in production");
  } else {
    try {
      const parsed = new URL(authUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        errors.push("AUTH_URL must be a public HTTPS origin without embedded credentials");
      } else if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        errors.push("AUTH_URL must be an origin without a path, query, or fragment");
      }
    } catch {
      errors.push("AUTH_URL must be a valid public HTTPS origin");
    }
  }

  const communicationProvider = env.COMMUNICATION_PROVIDER?.trim();
  if (!communicationProvider) {
    errors.push("COMMUNICATION_PROVIDER is required in production");
  } else if (deployment === "staging" && communicationProvider !== "deterministic") {
    errors.push("Staging requires COMMUNICATION_PROVIDER=deterministic");
  } else if (deployment === "production" && communicationProvider !== "disabled") {
    errors.push("Production requires COMMUNICATION_PROVIDER=disabled until a live adapter is implemented");
  }

  if (deployment === "staging") {
    const webhookSecretError = secretValidationError(
      "COMMUNICATION_TEST_WEBHOOK_SECRET",
      env.COMMUNICATION_TEST_WEBHOOK_SECRET,
    );
    if (webhookSecretError) errors.push(webhookSecretError);
    const webhookSecret = env.COMMUNICATION_TEST_WEBHOOK_SECRET?.trim();
    for (const name of PRODUCTION_SECRET_NAMES) {
      if (webhookSecret && webhookSecret === env[name]?.trim()) {
        errors.push(`COMMUNICATION_TEST_WEBHOOK_SECRET and ${name} must be independent secrets`);
      }
    }
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
