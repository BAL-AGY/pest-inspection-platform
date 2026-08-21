import { test, expect } from "@playwright/test";

/**
 * A homeowner who is clearly out of scope (outside the service area, or not
 * the homeowner) must be told immediately, not after answering every
 * remaining question and typing in their name/email/phone. Previously the
 * funnel only ever surfaced "not eligible" after the contact form — see
 * docs/GOAL_AUDIT.md's product-review findings. The fix is entirely
 * client-side (src/app/inspection/page.tsx): the server already returns
 * `inServiceArea`/`supportedPest` on every partial-answer response, this
 * just acts on that immediately instead of waiting for full completion.
 */

test("an out-of-service-area ZIP ends the funnel immediately, before any further question or contact form", async ({
  page,
}) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("90210"); // not in the seeded service area
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /thanks for reaching out/i })).toBeVisible();
  await expect(page.getByText(/outside our current service area/i)).toBeVisible();

  // Must never have reached the next question or the contact form.
  await expect(page.getByRole("heading", { name: /do you own this home/i })).toHaveCount(0);
  await expect(page.getByPlaceholder("Email")).toHaveCount(0);
});

test("answering 'No' to homeownership ends the funnel immediately, before the pest question or contact form", async ({
  page,
}) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301"); // in the seeded service area
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await page.getByRole("button", { name: "No" }).click();

  await expect(page.getByRole("heading", { name: /thanks for reaching out/i })).toBeVisible();
  await expect(page.getByText(/set up to book inspections for homeowners/i)).toBeVisible();

  // Must never have reached the pest question or the contact form.
  await expect(page.getByRole("heading", { name: /what pest issue/i })).toHaveCount(0);
  await expect(page.getByPlaceholder("Email")).toHaveCount(0);
});

test("a legitimate in-area homeowner is unaffected and continues to the next question normally", async ({ page }) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
});
