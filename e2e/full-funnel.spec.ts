import { test, expect } from "@playwright/test";

/**
 * THE DEMETRIUS ACCEPTANCE TEST — the single, canonical, repeatable proof
 * that "this prototype actually works end to end," matching every stage
 * the pest control company owner would walk through in a real acceptance
 * session: campaign URL with attribution → landing page → funnel start →
 * service area → pest problem → severity/urgency → homeowner/property →
 * contact info → qualification → availability → inspection booking →
 * confirmation → persisted lead → persisted appointment → persisted
 * attribution → owner login → lead visible in dashboard → appointment
 * visible (pipeline + calendar) → mark inspection complete → mark
 * customer won → record service arrangement → record actual contract
 * value → associate marketing spend → verify analytics/revenue/CAC/ROAS
 * update correctly, both as dashboard summary stats and per-campaign
 * attribution. Also proves things a demo walkthrough wouldn't: the
 * public funnel never leaks the internal "Potential Value Range" to a
 * homeowner (only staff, in the CRM, see it), double-booking is
 * atomically prevented for a second independent lead, and a staff-only
 * write endpoint rejects an invalid pest category/service arrangement.
 * Runs against the real dev server and real PostgreSQL test database —
 * nothing here is mocked or requires a paid external service. See
 * docs/ARCHITECTURE.md / TASKS.md "definition of done" for the origin
 * of this journey definition.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

test("real prospect moves through the full acquisition-to-outcome journey", async ({ page }) => {
  // 1-2. Traffic source lands on the public landing page.
  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=e2e_playwright");
  await expect(page.getByRole("heading", { name: /still seeing pests/i })).toBeVisible();

  await page.getByRole("link", { name: /get my free inspection/i }).click();
  await expect(page).toHaveURL(/\/inspection/);
  await expect(page.getByText("Potential Value Range", { exact: true })).toHaveCount(0);

  // 3. Qualification funnel — progressive, conditional questions.
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
  await page.getByRole("button", { name: "General Pest" }).click();

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
  let secondLeadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "general_pest" },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", {
      data: { visitorId: secondVisitorId, leadId: secondLeadId, leadToken: secondLeadToken, answers },
    });
    const body = await r.json();
    secondLeadId = body.lead.id;
    secondLeadToken = body.leadToken;
  }
  await page.request.post("/api/leads", {
    data: {
      visitorId: secondVisitorId,
      leadId: secondLeadId,
      leadToken: secondLeadToken,
      contact: { firstName: "Sam", lastName: "Lee", email: `sam.${Date.now()}@example.com`, phone: "+15125550199" },
    },
  });
  const conflictRes = await page.request.post("/api/appointments", {
    data: { leadId: secondLeadId, leadToken: secondLeadToken, start: scheduledStart, end: scheduledEnd },
  });
  expect(conflictRes.status()).toBe(409);

  // Owner login (staff auth).
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // 16-17. Owner dashboard and funnel analytics reflect the real booking.
  await expect(page.getByText("Cost per qualified booked inspection", { exact: true })).toBeVisible();
  // The first available appointment can legitimately be a later company-local
  // day (for example when this suite runs after business hours). Assert the
  // all-time booked funnel metric, not the operational "today" bucket.
  const bookedInspectionsCard = page.getByText("Booked inspections", { exact: true }).first().locator("..");
  await expect(bookedInspectionsCard).toContainText(/[1-9]/);

  // 13-15. Appointment + lead visible in CRM/pipeline/calendar.
  await page.goto("/dashboard/leads");
  const leadCard = page.locator(`a[href*="${leadId}"]`);
  await expect(leadCard).toBeVisible();
  await expect(leadCard).toContainText("Jordan Rivers");
  await leadCard.click();
  await expect(page).toHaveURL(new RegExp(leadId));
  await expect(page.locator("p.uppercase", { hasText: "sql" })).toBeVisible();
  await expect(page.getByLabel("Lead summary").getByText("73301", { exact: true })).toBeVisible();
  await expect(page.getByText("General Pest", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Potential Value Range", { exact: true })).toBeVisible();
  await expect(page.getByText("$200–$1,000", { exact: true })).toBeVisible();
  await expect(page.getByText("google", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("e2e_playwright", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/what's the zip code of the property/i)).toBeVisible();
  await expect(page.getByText("Qualified lead", { exact: true })).toBeVisible();
  await expect(page.getByText("Booked free home inspection", { exact: true })).toBeVisible();

  const invalidOutcomeMetadata = await page.request.patch(`/api/leads/${leadId}`, {
    data: { actualPestCategory: "attacker-invented", serviceArrangement: "WEEKLY" },
  });
  expect(invalidOutcomeMetadata.status()).toBe(400);

  const note = `Manual demo follow-up ${Date.now()}`;
  await page.getByPlaceholder("Add a note…").fill(note);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();

  // The same homeowner appointment must appear on the operational calendar.
  await page.goto("/dashboard/calendar?view=month");
  const calendarAppointment = page.locator(`a[href="/dashboard/leads/${leadId}"]`);
  await expect(calendarAppointment).toContainText("Jordan Rivers");
  await calendarAppointment.click();
  await expect(page).toHaveURL(new RegExp(leadId));

  // 19. Mark the inspection completed from the CRM.
  await page.getByRole("button", { name: /mark completed/i }).click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();

  // 20. Mark the customer Won with a contract value.
  await page.locator('input[name="contractValue"]').fill("450.00");
  await page.locator('select[name="actualPestCategory"]').selectOption("general_pest");
  await page.locator('select[name="serviceArrangement"]').selectOption("QUARTERLY");
  await page.getByRole("button", { name: "Mark Won" }).click();
  await expect(page.getByText(/current outcome:\s*won/i)).toBeVisible();
  await expect(page.getByText(/quarterly service/i).last()).toBeVisible();

  // 21-22. Analytics/ROI update from the real outcome. Cost metrics are
  // driven entirely by real entered data — never fabricated — so this
  // suite is written to be safely re-run against a persistent dev database
  // (values accumulate across runs) rather than assuming a pristine DB.
  await page.goto("/dashboard");
  await expect(page.getByText("Customers won", { exact: true }).first().locator("..")).toContainText(/[1-9]/);
  await expect(page.getByText("Revenue attributed", { exact: true }).locator("..")).toContainText(/\$\d/);

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
  await expect(page.getByText("Cost per qualified booked inspection", { exact: true }).locator("..")).toContainText(/\$\d/);
  await expect(page.getByText("Cost per qualified lead").locator("..")).toContainText(/\$\d/);
  await expect(page.getByText("Customer acquisition cost", { exact: true }).locator("..")).toContainText(/\$\d/);
  // "ROAS" also labels a table column further down the same page — scope
  // to the summary-stat section (the same disambiguation pattern used for
  // "Close rate" below) so this can't silently match the wrong element.
  const marketingEfficiency = page.getByRole("heading", { name: "Marketing efficiency" }).locator("..");
  await expect(marketingEfficiency.getByText("ROAS", { exact: true }).locator("..")).toContainText(/\d\.\d\dx/);
  await expect(page.getByText("Lead to qualified").locator("..")).toContainText(/%/);
  await expect(page.getByText("Qualified to booked").locator("..")).toContainText(/%/);
  await expect(page.getByText("Show rate").locator("..")).toContainText(/%/);
  const operations = page.getByRole("heading", { name: "Operations and conversion" }).locator("..");
  await expect(operations.getByText("Close rate", { exact: true }).locator("..")).toContainText(/%/);
  await expect(page.getByText("ROI", { exact: true }).locator("..")).toContainText(/%/);
  const attributedCampaignRow = page.getByRole("row", { name: /google \/ cpc.*e2e_playwright/i });
  await expect(attributedCampaignRow).toBeVisible();
  await expect(attributedCampaignRow).toContainText(/\$450\.00|\$\d/);
  // The same campaign row must also carry a real, computed ROAS, not a
  // blank/unavailable cell, once both spend and revenue exist for it.
  await expect(attributedCampaignRow).toContainText(/\d\.\d\dx/);
});
