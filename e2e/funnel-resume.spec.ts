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

  await expect(page.getByRole("heading", { name: /what are you seeing/i })).toBeVisible();
  await page.getByRole("button", { name: "Live pests", exact: true }).click();
  await page.getByRole("button", { name: "Droppings", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

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

test("multi-select symptoms persist through Back navigation and refresh", async ({ page }) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Rodents", exact: true }).click();

  await expect(page.getByRole("heading", { name: /what are you seeing/i })).toBeVisible();
  await page.getByRole("button", { name: "Live pests", exact: true }).click();
  await page.getByRole("button", { name: "Droppings", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /how would you describe the problem/i })).toBeVisible();

  // Back returns to the symptoms question with both prior selections still
  // shown as checked, and the unselected options still unchecked.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: /what are you seeing/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Live pests", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Droppings", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Nests / webs", exact: true })).toHaveAttribute("aria-pressed", "false");

  // Resuming through a refresh after re-confirming lands past the
  // question, not back at its start.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /how would you describe the problem/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /how would you describe the problem/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /what are you seeing/i })).toHaveCount(0);
});

/**
 * Root cause of the "qualification questions disappeared" report: the
 * resume-on-mount effect only checked `qualificationComplete` and
 * unconditionally jumped to the contact-form stage, with no awareness that
 * the resumed lead might already have an active appointment. A visitor
 * whose browser still held a leadId/leadToken from an already-booked visit
 * (a refresh right after booking, a returning tester, reopening the tab
 * later) was dropped straight into the contact form with every
 * qualification question silently skipped and no re-booking protection.
 * src/app/api/leads/route.ts now returns `activeAppointment` on a
 * continuation request, and src/app/inspection/page.tsx branches to the
 * "confirmed" stage when one exists.
 */
test("reloading after booking shows the confirmation, not a blank resume to the contact form", async ({ page }) => {
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Rodents", exact: true }).click();
  await page.getByRole("button", { name: "Live pests", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "It's a serious infestation", exact: true }).click();
  await page.getByRole("button", { name: "No" }).click();
  await page.getByRole("button", { name: "As soon as possible", exact: true }).click();

  const stamp = Date.now();
  await page.getByPlaceholder("First name").fill("Resume");
  await page.getByPlaceholder("Last name").fill("AfterBooking");
  await page.getByPlaceholder("Email").fill(`resume.after.booking.${stamp}@example.com`);
  await page.getByPlaceholder("Phone").fill("5125550188");
  await page.getByRole("button", { name: "See Available Times" }).click();

  const slotButtons = page.locator("button.rounded-md.border").filter({ hasNotText: "Book Free Inspection" });
  test.skip((await slotButtons.count()) === 0, "No availability in the default booking window — local test-data capacity exhausted, not a product bug.");
  await slotButtons.first().click();
  await page.getByRole("button", { name: "Book Free Inspection" }).click();
  await expect(page.getByRole("heading", { name: /you.re booked/i })).toBeVisible();

  // The exact repro: reload with the leadId/leadToken still in
  // localStorage — must show the booked confirmation again, not the
  // contact form with every qualification question missing.
  await page.reload();
  await expect(page.getByRole("heading", { name: /you.re booked/i })).toBeVisible();
  await expect(page.getByPlaceholder("First name")).toHaveCount(0);
  await expect(page.getByPlaceholder("ZIP code")).toHaveCount(0);
});
