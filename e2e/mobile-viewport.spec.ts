import { test, expect } from "@playwright/test";

/**
 * The public homeowner funnel is the single most important conversion path
 * in the platform (see CLAUDE.md) and most real acquisition traffic arrives
 * on a phone, but no existing test exercised the funnel at a mobile
 * viewport. This is a targeted, additive check — not a full multi-browser
 * matrix (which would require reviewing every existing test for
 * viewport-specific assumptions) — proving the golden path stays usable and
 * doesn't overflow horizontally on a small screen.
 */

test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE-class width

test("the homeowner funnel is usable and has no horizontal overflow at a phone viewport", async ({ page }) => {
  await page.goto("/inspection");

  const hasHorizontalOverflow = async () =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

  await expect(page.getByPlaceholder("ZIP code")).toBeVisible();
  expect(await hasHorizontalOverflow()).toBe(false);

  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes" })).toBeVisible();
  expect(await hasHorizontalOverflow()).toBe(false);

  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
  expect(await hasHorizontalOverflow()).toBe(false);
});

test("the owner dashboard has no horizontal overflow at a phone viewport", async ({ page }) => {
  const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await expect(page.getByRole("heading", { name: "Needs your attention today" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
});
