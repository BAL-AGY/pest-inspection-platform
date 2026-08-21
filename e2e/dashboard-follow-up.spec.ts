import { test, expect } from "@playwright/test";

/**
 * Codex's Step 24-era dashboard reports marketing/pest-category performance
 * well, but had no surface for "what should I actually do right now" —
 * an owner had to click into Calendar separately for today's appointments,
 * and there was no worklist for qualified leads who never booked (the exact
 * population a human has to personally follow up with while live automated
 * reminders aren't wired up). This proves the new "Needs your attention
 * today" overview section (src/app/dashboard/page.tsx) surfaces a real,
 * currently-unbooked qualified lead — not a static/demo placeholder.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

test("a qualified lead who hasn't booked appears in the owner's follow-up worklist", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-followup-${stamp}`;
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "rodents" },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", { data: { visitorId, leadId, leadToken, answers } });
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const contactRes = await page.request.post("/api/leads", {
    data: {
      visitorId,
      leadId,
      leadToken,
      contact: { firstName: "Follow", lastName: `Up${stamp}`, email: `followup.${stamp}@example.com`, phone: "+15125550188" },
    },
  });
  const contactBody = await contactRes.json();
  expect(contactBody.lead.classification).toBe("sql");
  // Deliberately never books — this is the exact "qualified, not yet
  // booked" population the worklist exists to surface.

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await expect(page.getByRole("heading", { name: "Needs your attention today" })).toBeVisible();
  const followUpRow = page.getByRole("link", { name: new RegExp(`Follow Up${stamp}\\s+sql`, "i") });
  await expect(followUpRow).toBeVisible();
});
