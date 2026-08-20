import { test, expect } from "@playwright/test";

/**
 * Verifies the durable suppression system (docs/GOAL_AUDIT.md Communications
 * gap): a contact who opts out must stay suppressed even when they re-enter
 * the funnel under a brand new visitorId/Lead row, which is exactly the gap
 * `Lead.optedOutAt` alone could not close. Runs against the real dev server
 * and real SQLite dev database, like e2e/full-funnel.spec.ts.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

async function createLead(
  page: import("@playwright/test").Page,
  visitorId: string,
  contact: { firstName: string; lastName: string; email: string; phone: string },
) {
  let leadId: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "ants" },
    { pestSeverity: "minor" },
    { hasExistingProvider: false },
    { timeline: "flexible" },
  ]) {
    const r = await page.request.post("/api/leads", { data: { visitorId, leadId, answers } });
    leadId = (await r.json()).lead.id;
  }
  const r = await page.request.post("/api/leads", {
    data: { visitorId, leadId, contact, smsConsent: true, emailConsent: true },
  });
  const body = await r.json();
  return { leadId: body.lead.id as string, lead: body.lead as Record<string, unknown> };
}

test("opted-out contact stays suppressed across a brand new lead/session", async ({ page }) => {
  const stamp = Date.now();
  const email = `suppress.${stamp}@example.com`;
  const phone = "+15125550171";

  // 1-2. First session: a real contact gives consent and becomes a Lead.
  const first = await createLead(page, `e2e-suppress-first-${stamp}`, {
    firstName: "Casey",
    lastName: "Original",
    email,
    phone,
  });
  expect(first.lead.emailConsent).toBe(true);
  expect(first.lead.smsConsent).toBe(true);

  // Owner opts this contact out through the existing CRM mechanism
  // (PATCH /api/leads/[id] { optedOut: true }).
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const optOutRes = await page.request.patch(`/api/leads/${first.leadId}`, {
    data: { optedOut: true },
  });
  expect(optOutRes.status()).toBe(200);
  const optOutBody = await optOutRes.json();
  expect(optOutBody.lead.optedOutAt).toBeTruthy();

  // 3-4. A brand new session/visitor, unrelated Lead row, submits the exact
  // same email and phone and again requests consent. The new Lead must not
  // be able to (re)activate marketing permission for a suppressed contact.
  const second = await createLead(page, `e2e-suppress-second-${stamp}`, {
    firstName: "Casey",
    lastName: "Returning",
    email,
    phone,
  });
  expect(second.leadId).not.toBe(first.leadId);
  expect(second.lead.emailConsent).toBe(false);
  expect(second.lead.smsConsent).toBe(false);
  expect(second.lead.optedOutAt).toBeTruthy();

  // 6. An unrelated, never-suppressed contact is unaffected — suppression
  // must not over-block contacts who never opted out.
  const unrelated = await createLead(page, `e2e-suppress-unrelated-${stamp}`, {
    firstName: "Jamie",
    lastName: "Neverout",
    email: `unrelated.${stamp}@example.com`,
    phone: "+15125550172",
  });
  expect(unrelated.lead.emailConsent).toBe(true);
  expect(unrelated.lead.smsConsent).toBe(true);
  expect(unrelated.lead.optedOutAt).toBeFalsy();
});
