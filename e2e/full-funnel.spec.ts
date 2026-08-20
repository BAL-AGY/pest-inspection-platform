import { test, expect } from "@playwright/test";

/**
 * Drives the real, required end-to-end journey (docs/ARCHITECTURE.md /
 * TASKS.md "definition of done"): traffic → landing → qualification →
 * contact capture → lead scoring/MQL/SQL → scheduling with double-booking
 * prevention → CRM/pipeline → inspection outcome → dashboard/analytics
 * update. Runs against the real dev server and real SQLite dev database —
 * nothing here is mocked.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

test("real prospect moves through the full acquisition-to-outcome journey", async ({ page }) => {
  // 1-2. Traffic source lands on the public landing page.
  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=e2e_playwright");
  await expect(page.getByRole("heading", { name: /still seeing pests/i })).toBeVisible();

  await page.getByRole("link", { name: /get my free inspection/i }).click();
  await expect(page).toHaveURL(/\/inspection/);

  // 3. Qualification funnel — progressive, conditional questions.
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
  await page.getByRole("button", { name: "Termites" }).click();

  await expect(page.getByRole("heading", { name: /describe the problem/i })).toBeVisible();
  await page.getByRole("button", { name: /serious infestation/i }).click();

  await expect(page.getByRole("heading", { name: /pay for pest control service/i })).toBeVisible();
  await page.getByRole("button", { name: "No" }).click();

  await expect(page.getByRole("heading", { name: /when would you like this addressed/i })).toBeVisible();
  await page.getByRole("button", { name: /as soon as possible/i }).click();

  // 5-9. Contact capture -> lead creation, scoring, MQL/SQL classification server-side.
  await expect(page.getByRole("heading", { name: /where should we send/i })).toBeVisible();
  await page.getByPlaceholder("First name").fill("Jordan");
  await page.getByPlaceholder("Last name").fill("Rivers");
  await page.getByPlaceholder("Email").fill(`jordan.${Date.now()}@example.com`);
  await page.getByPlaceholder("Phone").fill("+15125550100");

  const leadResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/leads") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /see available times/i }).click();
  const leadResponse = await leadResponsePromise;
  const leadBody = await leadResponse.json();
  expect(leadBody.lead.classification).toBe("sql");
  expect(leadBody.inServiceArea).toBe(true);
  const leadId: string = leadBody.lead.id;

  // 10-11. Eligible prospect sees valid inspection availability and books.
  await expect(page.getByRole("heading", { name: /pick a time/i })).toBeVisible();
  const slotButtons = page.locator("button", { hasText: /am|pm/i });
  await expect(slotButtons.first()).toBeVisible();
  await slotButtons.first().click();

  const bookResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/appointments") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /book free inspection/i }).click();
  const bookResponse = await bookResponsePromise;
  expect(bookResponse.status()).toBe(200);
  const bookBody = await bookResponse.json();
  const scheduledStart: string = bookBody.appointment.scheduledStart;
  const scheduledEnd: string = bookBody.appointment.scheduledEnd;

  await expect(page.getByRole("heading", { name: /you're booked/i })).toBeVisible();

  // 12. Double-booking prevention: a second, independently qualified lead
  // must not be able to take the exact same slot.
  const secondVisitorId = `e2e-second-${Date.now()}`;
  let secondLeadId: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "termites" },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", {
      data: { visitorId: secondVisitorId, leadId: secondLeadId, answers },
    });
    secondLeadId = (await r.json()).lead.id;
  }
  await page.request.post("/api/leads", {
    data: {
      visitorId: secondVisitorId,
      leadId: secondLeadId,
      contact: { firstName: "Sam", lastName: "Lee", email: `sam.${Date.now()}@example.com`, phone: "+15125550199" },
    },
  });
  const conflictRes = await page.request.post("/api/appointments", {
    data: { leadId: secondLeadId, start: scheduledStart, end: scheduledEnd },
  });
  expect(conflictRes.status()).toBe(409);

  // Owner login (staff auth).
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // 16-17. Owner dashboard and funnel analytics reflect the real booking.
  await expect(page.getByText(/cost per qualified booked inspection/i)).toBeVisible();
  const inspectionsTodayCard = page.getByText("Booked today").locator("..");
  await expect(inspectionsTodayCard).toContainText(/[1-9]/);

  // 13-15. Appointment + lead visible in CRM/pipeline/calendar.
  await page.goto("/dashboard/leads");
  const leadCard = page.locator(`a[href*="${leadId}"]`);
  await expect(leadCard).toBeVisible();
  await expect(leadCard).toContainText("Jordan Rivers");
  await leadCard.click();
  await expect(page).toHaveURL(new RegExp(leadId));
  await expect(page.locator("p.uppercase", { hasText: "sql" })).toBeVisible();

  // 19. Mark the inspection completed from the CRM.
  await page.getByRole("button", { name: /mark completed/i }).click();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();

  // 20. Mark the customer Won with a contract value.
  await page.locator('input[name="contractValue"]').fill("450.00");
  await page.getByRole("button", { name: "Mark Won" }).click();
  await expect(page.getByText(/current outcome:\s*won/i)).toBeVisible();

  // 21-22. Analytics/ROI update from the real outcome. Cost metrics are
  // driven entirely by real entered data — never fabricated — so this
  // suite is written to be safely re-run against a persistent dev database
  // (values accumulate across runs) rather than assuming a pristine DB.
  await page.goto("/dashboard");
  await expect(page.getByText("Customers won").locator("..")).toContainText(/[1-9]/);
  await expect(page.getByText("Revenue attributed").locator("..")).toContainText(/\$\d/);

  await page.goto("/dashboard/marketing");
  const spendMarker = `e2e-${Date.now()}`;
  await page.locator('input[name="source"]').fill(spendMarker);
  await page.locator('input[name="periodStart"]').fill("2026-08-01");
  await page.locator('input[name="periodEnd"]').fill("2026-08-31");
  await page.locator('input[name="amount"]').fill("100.00");
  await page.getByRole("button", { name: /add spend entry/i }).click();
  await expect(page.getByText(spendMarker)).toBeVisible();

  // Once any real spend exists, cost-per-booked-inspection must be a real
  // computed number (never "no data yet" once both spend and a booking
  // exist — both are true after this run).
  await page.goto("/dashboard");
  await expect(page.getByText("Cost per booked inspection").locator("..")).toContainText(/\$\d/);
});
