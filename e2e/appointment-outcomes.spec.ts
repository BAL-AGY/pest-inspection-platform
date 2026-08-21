import { test, expect } from "@playwright/test";

/**
 * docs/GOAL_AUDIT.md's Testing table has long flagged "no no-show/lost-
 * outcome scenario yet" as a real gap — the owner-facing "No-show" action
 * (src/app/dashboard/leads/[id]/page.tsx `markNoShow`) directly feeds the
 * show rate metric (src/lib/dashboard-metrics.ts: completed / (completed +
 * no-shows)), which is adjacent to the platform's north-star metric, but
 * had no end-to-end coverage proving the action actually persists and is
 * reflected back to the owner. This proves the full path against the real
 * dev DB, the same pattern as e2e/communication-log.spec.ts.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

test("marking a booked appointment as a no-show persists and is reflected in the CRM", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-noshow-${stamp}`;
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
      contact: { firstName: "NoShow", lastName: `Test${stamp}`, email: `noshow.${stamp}@example.com`, phone: "+15125550199" },
    },
  });
  const contactBody = await contactRes.json();
  leadToken = contactBody.leadToken;
  expect(contactBody.lead.classification).toBe("sql");

  const availabilityRes = await page.request.get(`/api/availability?leadId=${leadId}`, {
    headers: { "X-Funnel-Token": leadToken! },
  });
  const availabilityBody = await availabilityRes.json();
  const slot = availabilityBody.slots[0] as { start: string; end: string };

  const bookingRes = await page.request.post("/api/appointments", {
    data: { leadId, leadToken, start: slot.start },
  });
  expect(bookingRes.ok()).toBe(true);
  const bookingBody = await bookingRes.json();
  const appointmentId = bookingBody.appointment.id as string;

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto(`/dashboard/leads/${leadId}`);
  const appointmentRow = page.locator("div", { has: page.getByRole("button", { name: "No-show" }) }).first();
  await expect(appointmentRow.getByText("booked", { exact: true })).toBeVisible();

  await appointmentRow.getByRole("button", { name: "No-show" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/leads/${leadId}$`));
  await expect(page.getByText("no_show", { exact: true })).toBeVisible();

  // The action buttons only render for status === "booked" — once
  // recorded as a no-show, they must disappear (no double-action).
  await expect(page.getByRole("button", { name: "No-show" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark completed" })).toHaveCount(0);

  const verifyRes = await page.request.get(`/api/leads/${leadId}`);
  const verifyBody = await verifyRes.json();
  const persisted = (verifyBody.lead.appointments as { id: string; status: string }[]).find(
    (a) => a.id === appointmentId,
  );
  expect(persisted?.status).toBe("no_show");
});

test("marking a lead's outcome as lost records it and never attributes revenue", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-lost-${stamp}`;
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "fleas" },
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
      contact: { firstName: "Lost", lastName: `Test${stamp}`, email: `lost.${stamp}@example.com`, phone: "+15125550177" },
    },
  });
  const contactBody = await contactRes.json();
  expect(contactBody.lead.classification).toBe("sql");

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto(`/dashboard/leads/${leadId}`);
  await page.getByRole("button", { name: "Mark Lost" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/leads/${leadId}$`));
  await expect(page.getByText(/current outcome:\s*lost/i)).toBeVisible();

  const verifyRes = await page.request.get(`/api/leads/${leadId}`);
  const verifyBody = await verifyRes.json();
  expect(verifyBody.lead.outcome).toBe("lost");
  expect(verifyBody.lead.status).toBe("customer_lost");
  expect(verifyBody.lead.contractValueCents).toBeNull();
});
