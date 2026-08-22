import { test, expect } from "@playwright/test";

/**
 * Demetrius's core business rule (docs/SERVICE_CATALOG.md): potential value
 * ranges are internal acquisition context for staff only, computed from the
 * pest category — general pest $200–$1,000, fleas $400–$1,000, rodents
 * $250–$5,000+ — and must NEVER be presented to a homeowner as a quote.
 * Every property is different; only an in-person inspection determines
 * actual pricing. This walks the real public funnel for the highest-value,
 * open-ended category (rodents, the one most tempting to "sell" with a
 * number) through every stage and asserts no dollar amount or potential-
 * value language ever renders on a homeowner-facing page — a direct,
 * permanent regression test for the rule itself, not just the plumbing
 * that currently respects it.
 */

test("the public funnel never quotes a dollar amount or potential-value range to a homeowner, even for the highest-ceiling category", async ({
  page,
}) => {
  const stamp = Date.now();

  async function assertNoPricingLeak() {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\$\s?\d/);
    expect(bodyText.toLowerCase()).not.toContain("potential value");
  }

  await page.goto("/inspection");
  await assertNoPricingLeak();

  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await assertNoPricingLeak();

  await page.getByRole("button", { name: "Yes" }).click();
  await assertNoPricingLeak();

  await page.getByRole("button", { name: "Rodents", exact: true }).click(); // highest, open-ended range
  await assertNoPricingLeak();

  await page.getByRole("button", { name: "It's a serious infestation", exact: true }).click();
  await assertNoPricingLeak();

  await page.getByRole("button", { name: "No" }).click();
  await assertNoPricingLeak();

  await page.getByRole("button", { name: "As soon as possible", exact: true }).click();
  await assertNoPricingLeak();

  await page.getByPlaceholder("First name").fill("Pricing");
  await page.getByPlaceholder("Last name").fill(`Check${stamp}`);
  await page.getByPlaceholder("Email").fill(`pricing.check.${stamp}@example.com`);
  await page.getByPlaceholder("Phone").fill("5125550188");
  await assertNoPricingLeak();
  await page.getByRole("button", { name: "See Available Times" }).click();
  await assertNoPricingLeak();
});

test("the landing page states an inspection is required for accurate pricing and never quotes a price itself", async ({ page }) => {
  await page.goto("/");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\$\s?\d/);
  expect(bodyText.toLowerCase()).toMatch(/inspect.*before.*(pricing|treatment)|every property is different/);
});
