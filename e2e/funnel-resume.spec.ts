import { test, expect } from "@playwright/test";

/**
 * A page refresh mid-funnel must not discard in-progress qualification
 * answers or silently start a second Lead row for the same visitor.
 * src/lib/visitor.ts already persists leadId/leadToken to localStorage on
 * every successful response; src/app/inspection/page.tsx now reads them
 * back on mount and issues a no-op resume call to restore state. This
 * proves the restore actually happens against the real API, not just that
 * the page doesn't crash.
 */

test("refreshing mid-funnel restores prior answers instead of starting over", async ({ page }) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301"); // in the seeded service area
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();

  await page.reload();

  // Must resume straight to the next unanswered question, not restart at
  // the ZIP code screen.
  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
  await expect(page.getByPlaceholder("ZIP code")).toHaveCount(0);
});

test("refreshing after completing qualification resumes at the contact form, not from scratch", async ({ page }) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
  await page.getByRole("button", { name: "Rodents", exact: true }).click();

  await expect(page.getByRole("heading", { name: /how would you describe the problem/i })).toBeVisible();
  await page.getByRole("button", { name: "It's a serious infestation", exact: true }).click();

  await expect(page.getByRole("heading", { name: /pay for pest control service from another company/i })).toBeVisible();
  await page.getByRole("button", { name: "No" }).click();

  await expect(page.getByRole("heading", { name: /when would you like this addressed/i })).toBeVisible();
  await page.getByRole("button", { name: "As soon as possible", exact: true }).click();

  await expect(page.getByPlaceholder("Email")).toBeVisible();

  await page.reload();

  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.getByPlaceholder("ZIP code")).toHaveCount(0);
});
