import { test, expect } from "@playwright/test";

/**
 * Acquisition Intelligence (src/app/dashboard/intelligence/page.tsx) adds a
 * case-study-driven benchmark/recommendation system alongside the existing
 * dashboard, kept in its own section per the explicit "do not clutter the
 * existing live funnel diagram" requirement. Since no verified pest-control
 * case studies are committed to the repo (docs/marketing-intelligence/
 * case-studies/ is empty by design — see docs/marketing-intelligence/
 * README.md), this proves the honest empty states render, and that the
 * experiment tracker's live metrics are computed from real attributed
 * traffic (reusing the same campaignPerformance() logic as Marketing
 * Performance) rather than fabricated.
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

test("Acquisition Intelligence nav link, empty states, and category separation render correctly", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "Intelligence" }).click();
  await expect(page).toHaveURL(/\/dashboard\/intelligence/);

  await expect(page.getByRole("heading", { name: "Acquisition Intelligence" })).toBeVisible();
  // The three-category separation must be explicit, not implied.
  await expect(page.getByText("external industry evidence")).toBeVisible();
  await expect(page.getByText("platform inferences")).toBeVisible();
  await expect(page.getByText("your real first-party data")).toBeVisible();

  // No verified case studies are committed — every evidence-dependent
  // section must show an honest empty state, never fabricated numbers.
  await expect(page.getByText("Insufficient benchmark data")).toBeVisible();
  await expect(page.getByText("No verified pest-control case studies imported yet")).toBeVisible();
  await expect(page.getByText("No recommendations yet")).toBeVisible();

  // No case-study load errors (the repo's committed case-studies directory,
  // if any files exist, must all be schema-valid).
  await expect(page.getByText(/case-study file.*failed validation/)).toHaveCount(0);
});

test("adding an experiment tracks it against real attributed traffic, not fabricated numbers", async ({ page }) => {
  const stamp = Date.now();
  const utmSource = `intel-test-${stamp}`;
  const visitorId = `e2e-intel-${stamp}`;

  // Create one real, fully-qualified lead attributed to this exact utm
  // source before the experiment exists, proving the tracker picks up
  // pre-existing real traffic rather than requiring its own event stream.
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
      data: { visitorId, leadId, leadToken, answers, attribution: { source: utmSource, medium: "test_medium", campaign: "test_campaign" } },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const contactRes = await page.request.post("/api/leads", {
    data: { visitorId, leadId, leadToken, contact: { firstName: "Intel", lastName: `Test${stamp}`, email: `intel.test.${stamp}@example.com`, phone: "+15125550188" } },
  });
  expect((await contactRes.json()).lead.classification).toBe("sql");

  await loginAsOwner(page);
  await page.goto("/dashboard/intelligence");

  await page.getByPlaceholder(/Hypothesis/).fill(`Test hypothesis ${stamp}`);
  await page.locator('form:has(input[name="hypothesis"]) select[name="platform"]').selectOption("google_search");
  await page.getByPlaceholder("utm_source (must match real traffic)").fill(utmSource);
  await page.getByRole("button", { name: "Add experiment" }).click();

  await expect(page.getByText(`Test hypothesis ${stamp}`)).toBeVisible();
  // The just-created lead is real, qualified traffic under this exact utm
  // source — the tracker must reflect it live, not show zero/fabricated.
  const card = page.locator("p", { hasText: `Test hypothesis ${stamp}` }).locator("..").locator("..").locator("..");
  await expect(card).toContainText(/Leads\s*1/);
});

test("Acquisition Intelligence has no horizontal overflow at mobile widths", async ({ page }) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await loginAsOwner(page);
    await page.goto("/dashboard/intelligence");
    await expect(page.getByRole("heading", { name: "Acquisition Intelligence" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
});
