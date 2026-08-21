import { deploymentEnvironment, secretValidationError } from "./environment";

const DEVELOPMENT_OWNER_EMAIL = "owner@example.com";
const DEVELOPMENT_OWNER_PASSWORD = "changeme123";

export interface SeedOwnerConfig {
  email: string;
  password: string;
}

export function assertStagingDemoCommand(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DEPLOYMENT_ENV !== "staging") {
    throw new Error("Staging demo commands require DEPLOYMENT_ENV=staging.");
  }
  if (env.STAGING_DEMO_CONFIRM !== "demo-pest-control") {
    throw new Error("Set STAGING_DEMO_CONFIRM=demo-pest-control to target the demo tenant.");
  }
}

export function resolveSeedOwnerConfig(env: NodeJS.ProcessEnv = process.env): SeedOwnerConfig {
  const production = env.NODE_ENV === "production";
  const deployment = deploymentEnvironment(env);
  const email = env.SEED_OWNER_EMAIL?.trim();
  const password = env.SEED_OWNER_PASSWORD;

  if (production) {
    if (!email) {
      throw new Error(
        "SEED_OWNER_EMAIL is required when explicitly provisioning a production owner",
      );
    }
    const passwordError = secretValidationError("SEED_OWNER_PASSWORD", password);
    if (passwordError) throw new Error(passwordError);
    if (email.toLowerCase() === DEVELOPMENT_OWNER_EMAIL) {
      throw new Error("The development owner email cannot be used for production provisioning");
    }
    if (deployment === "staging") assertStagingDemoCommand(env);
  }

  return {
    email: email || DEVELOPMENT_OWNER_EMAIL,
    password: password || DEVELOPMENT_OWNER_PASSWORD,
  };
}
