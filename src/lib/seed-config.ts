import { secretValidationError } from "./environment";

const DEVELOPMENT_OWNER_EMAIL = "owner@example.com";
const DEVELOPMENT_OWNER_PASSWORD = "changeme123";

export interface SeedOwnerConfig {
  email: string;
  password: string;
}

export function resolveSeedOwnerConfig(env: NodeJS.ProcessEnv = process.env): SeedOwnerConfig {
  const production = env.NODE_ENV === "production";
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
  }

  return {
    email: email || DEVELOPMENT_OWNER_EMAIL,
    password: password || DEVELOPMENT_OWNER_PASSWORD,
  };
}
