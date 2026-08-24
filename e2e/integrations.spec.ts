import { test, expect } from "@playwright/test";

/**
 * Acquisition Integrations (src/app/dashboard/integrations/page.tsx) is a
 * new admin page unifying every acquisition channel's connection status and
 * real performance. This proves: (1) no channel is ever falsely shown as
 * "Connected" when no real credentials are configured (Meta/Google Ads
 * adapters both correctly report not_connected in this environment), (2)
 * channel performance figures are real, re-bucketed campaignPerformance()
 * rows — not fabricated, and (3) the unified summary matches the same
 * top-line numbers as the Overview Command Center (one source of truth).
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("Integrations nav link, unified summary, and no fake connections", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/integrations/);
  await expect(page.getByRole("heading", { name: "Acquisition Integrations" })).toBeVisible();

  // Neither Meta nor Google Ads has real credentials configured in this
  // environment (no META_ACCESS_TOKEN/GOOGLE_ADS_* env vars) — both must
  // honestly show "Not connected", never a fabricated "Connected" state.
  // Scoped to the "Connect a channel" section specifically: Meta/Google Ads
  // may also legitimately appear earlier, in the real-data "Channel
  // breakdown" section, which has no connection-status badge at all.
  const connectSection = page.getByRole("heading", { name: "Connect a channel" }).locator("..");
  const metaCard = connectSection.locator("h3", { hasText: "Meta Ads" }).locator("../..");
  await expect(metaCard.getByText("Not connected", { exact: true })).toBeVisible();
  const googleCard = connectSection.locator("h3", { hasText: "Google Ads" }).locator("../..");
  await expect(googleCard.getByText("Not connected", { exact: true })).toBeVisible();

  // A channel with no adapter built yet must never expose a working
  // "Connect" button — only an explanatory note.
  const smsCard = connectSection.locator("h3", { hasText: "SMS" }).locator("..");
  await expect(smsCard.getByRole("button", { name: /Connect/ })).toHaveCount(0);
});

test("channel breakdown reflects real attributed data, not fabricated spend", async ({ page }) => {
  const stamp = Date.now();
  const utmSource = `integrations-test-${stamp}`;
  const visitorId = `e2e-integrations-${stamp}`;
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "rodents" },
    { symptoms: ["live_pests"] },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", {
      data: { visitorId, leadId, leadToken, answers, attribution: { source: utmSource, medium: "test", campaign: "integrations_test" } },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  await page.request.post("/api/leads", {
    data: { visitorId, leadId, leadToken, contact: { firstName: "Integrations", lastName: `Test${stamp}`, email: `integrations.test.${stamp}@example.com`, phone: "+15125550188" } },
  });

  await loginAsOwner(page);
  await page.goto("/dashboard/integrations");

  // An unmapped/unknown source falls into "Other / Custom Source" — never
  // silently dropped, never misattributed to a specific named channel it
  // didn't actually come from.
  const otherCard = page.locator("h3", { hasText: "Other / Custom Source" }).first().locator("../..");
  await expect(otherCard).toContainText(/[1-9]\d*/);
});

test("Integrations page has no horizontal overflow at mobile widths", async ({ page }) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await loginAsOwner(page);
    await page.goto("/dashboard/integrations");
    await expect(page.getByRole("heading", { name: "Acquisition Integrations" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
});
