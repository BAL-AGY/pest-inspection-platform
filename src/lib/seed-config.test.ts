import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { resolveSeedOwnerConfig } from "./seed-config";

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

  it("keeps deterministic development/test seed credentials available", () => {
    expect(resolveSeedOwnerConfig({ NODE_ENV: "test" })).toEqual({
      email: "owner@example.com",
      password: "changeme123",
    });
  });

  it("bcrypt hashing verifies the credential without storing plaintext", async () => {
    const password = "seed_8CRvxgYQm4zkjS7f9uN2dL6pW3aT1hKe";
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
    await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-password", hash)).resolves.toBe(false);
  });
});
