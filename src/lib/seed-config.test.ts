import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { assertStagingDemoCommand, resolveSeedOwnerConfig } from "./seed-config";

describe("owner seed configuration", () => {
  it("refuses production owner provisioning without explicit credentials", () => {
    expect(() => resolveSeedOwnerConfig({ NODE_ENV: "production" })).toThrow(
      /SEED_OWNER_EMAIL/,
    );
  });

  it.each(["changeme123", "replace-with-a-real-secret", "too-short"])(
    "refuses unsafe production password %s",
    (password) => {
      expect(() =>
        resolveSeedOwnerConfig({
          NODE_ENV: "production",
          SEED_OWNER_EMAIL: "owner@real-company.invalid",
          SEED_OWNER_PASSWORD: password,
        }),
      ).toThrow(/SEED_OWNER_PASSWORD/);
    },
  );

  it("refuses the deterministic development owner identity in production", () => {
    expect(() =>
      resolveSeedOwnerConfig({
        NODE_ENV: "production",
        SEED_OWNER_EMAIL: "owner@example.com",
        SEED_OWNER_PASSWORD: "seed_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe",
      }),
    ).toThrow(/development owner email/);
  });

  it("accepts explicit strong production owner credentials", () => {
    expect(
      resolveSeedOwnerConfig({
        NODE_ENV: "production",
        SEED_OWNER_EMAIL: "owner@real-company.invalid",
        SEED_OWNER_PASSWORD: "seed_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe",
      }),
    ).toEqual({
      email: "owner@real-company.invalid",
      password: "seed_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe",
    });
  });

  it("requires an explicit staging tenant confirmation", () => {
    const stagingPassword = "s".repeat(40);
    expect(() =>
      resolveSeedOwnerConfig({
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "staging",
        SEED_OWNER_EMAIL: "owner@staging.invalid",
        SEED_OWNER_PASSWORD: stagingPassword,
      }),
    ).toThrow(/STAGING_DEMO_CONFIRM/);

    expect(
      resolveSeedOwnerConfig({
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "staging",
        STAGING_DEMO_CONFIRM: "demo-pest-control",
        SEED_OWNER_EMAIL: "owner@staging.invalid",
        SEED_OWNER_PASSWORD: stagingPassword,
      }),
    ).toEqual({
      email: "owner@staging.invalid",
      password: stagingPassword,
    });
  });

  it("keeps deterministic development/test seed credentials available", () => {
    expect(resolveSeedOwnerConfig({ NODE_ENV: "test" })).toEqual({
      email: "owner@example.com",
      password: "changeme123",
    });
  });

  it("prevents staging reset/seed commands outside the confirmed demo tenant", () => {
    expect(() => assertStagingDemoCommand({ NODE_ENV: "production", DEPLOYMENT_ENV: "production" })).toThrow(
      /DEPLOYMENT_ENV=staging/,
    );
    expect(() => assertStagingDemoCommand({ NODE_ENV: "production", DEPLOYMENT_ENV: "staging" })).toThrow(
      /STAGING_DEMO_CONFIRM/,
    );
    expect(() => assertStagingDemoCommand({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "staging",
      STAGING_DEMO_CONFIRM: "demo-pest-control",
    })).not.toThrow();
  });

  it("bcrypt hashing verifies the credential without storing plaintext", async () => {
    const password = "seed_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe";
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
    await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-password", hash)).resolves.toBe(false);
  });
});
