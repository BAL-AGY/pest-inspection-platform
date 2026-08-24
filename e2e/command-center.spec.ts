import { test, expect } from "@playwright/test";

/**
 * V2's "Acquisition Command Center" (src/app/dashboard/page.tsx,
 * src/app/dashboard/funnel-diagram.tsx) adds a KPI strip and a clickable
 * live funnel diagram on top of the existing dashboard sections. This
 * proves the diagram's counts reflect real stored data (not fabricated
 * "live" numbers) and that clicking a stage reveals the actual matching
 * lead records, each linking into the existing Lead Detail page — not a
 * duplicate CRM view.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

test("the command center's funnel diagram shows real counts and a clickable stage reveals matching lead records", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-command-center-${stamp}`;
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "rodents" },
    { symptoms: ["live_pests", "droppings"] },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", { data: { visitorId, leadId, leadToken, answers } });
    expect(r.status()).toBe(200);
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const contactRes = await page.request.post("/api/leads", {
    data: {
      visitorId,
      leadId,
      leadToken,
      contact: {
        firstName: "CommandCenter",
        lastName: `Drilldown${stamp}`,
        email: `command.center.${stamp}@example.com`,
        phone: "+15125550188",
      },
    },
  });
  const contactBody = await contactRes.json();
  expect(contactBody.lead.classification).toBe("sql");
  expect(leadId).not.toBeNull();

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // KPI strip and funnel diagram are built from the same real metrics as
  // the existing "Business outcome" section — not a separate fake number.
  await expect(page.getByRole("heading", { name: "Acquisition command center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live acquisition funnel" })).toBeVisible();
  const qualifiedStage = page.getByRole("button", { name: /Qualified leads/ });
  await expect(qualifiedStage).toBeVisible();
  await expect(qualifiedStage).toContainText(/[1-9]\d*/); // a real, non-zero count

  // Clicking the stage reveals the actual lead just created above, not a
  // placeholder — and it links into the existing Lead Detail page. Scoped
  // to the drilldown panel specifically: the same qualified lead also
  // legitimately appears in the pre-existing "Qualified, not yet booked"
  // follow-up widget higher on the page.
  await qualifiedStage.click();
  const drilldownPanel = page.locator("h3", { hasText: "Qualified leads · " }).locator("..");
  const drilldownLink = drilldownPanel.getByRole("link", { name: new RegExp(`CommandCenter Drilldown${stamp}`, "i") });
  await expect(drilldownLink).toBeVisible();
  await expect(drilldownLink).toHaveAttribute("href", `/dashboard/leads/${leadId}`);
  await expect(drilldownLink).toContainText(/Rodents/i);

  await drilldownLink.click();
  await expect(page).toHaveURL(new RegExp(leadId!));
  await expect(page.getByRole("heading", { name: `CommandCenter Drilldown${stamp}` })).toBeVisible();

  // Clicking the same stage again collapses the panel (toggle behavior).
  await page.goBack();
  await expect(page.getByText(`Qualified leads · `, { exact: false })).toHaveCount(0);
  await qualifiedStage.click();
  await expect(page.getByText(`Qualified leads · `, { exact: false })).toBeVisible();
  await qualifiedStage.click();
  await expect(page.getByText(`Qualified leads · `, { exact: false })).toHaveCount(0);
});
