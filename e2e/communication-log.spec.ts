import { test, expect } from "@playwright/test";

/**
 * Verifies the persistent communication delivery log (docs/GOAL_AUDIT.md
 * Critical Path item 4): every send attempt through the shared gate
 * (`sendIfAllowed`) is recorded, whether it's actually sent or blocked.
 * Runs against the real dev server and real SQLite dev database, like
 * e2e/full-funnel.spec.ts and e2e/suppression.spec.ts.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

interface CommunicationRecord {
  type: string;
  status: string;
  channel: string;
  companyId: string;
  leadId: string;
  appointmentId: string | null;
  blockedReason: string | null;
}

async function createSqlLead(
  page: import("@playwright/test").Page,
  visitorId: string,
  contact: { firstName: string; lastName: string; email: string; phone: string },
) {
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "termites" },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", { data: { visitorId, leadId, leadToken, answers } });
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const r = await page.request.post("/api/leads", {
    data: { visitorId, leadId, leadToken, contact, smsConsent: true, emailConsent: true },
  });
  const body = await r.json();
  return { leadId: body.lead.id as string, leadToken: body.leadToken as string };
}

async function firstAvailableSlot(page: import("@playwright/test").Page, leadId: string, leadToken: string) {
  const r = await page.request.get(`/api/availability?leadId=${leadId}`, {
    headers: { "X-Funnel-Token": leadToken },
  });
  const body = await r.json();
  return body.slots[0] as { start: string; end: string };
}

async function getLead(page: import("@playwright/test").Page, leadId: string) {
  const r = await page.request.get(`/api/leads/${leadId}`);
  const body = await r.json();
  return body.lead as { communications: CommunicationRecord[]; companyId: string };
}

test.describe("communication delivery log", () => {
  test("booking, reschedule, and cancellation each persist a communication record", async ({ page }) => {
    const stamp = Date.now();

    // Staff session first — GET/PATCH /api/leads/[id] require it, and
    // cookies persist across all subsequent page.request calls.
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
    await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const { leadId, leadToken } = await createSqlLead(page, `e2e-comm-log-${stamp}`, {
      firstName: "Riley",
      lastName: "Booker",
      email: `riley.${stamp}@example.com`,
      phone: "+15125550180",
    });

    // 1. Book — should persist a SENT appointment_confirmation record.
    const slot = await firstAvailableSlot(page, leadId, leadToken);
    const bookRes = await page.request.post("/api/appointments", {
      data: { leadId, leadToken, start: slot.start, end: slot.end },
    });
    expect(bookRes.status()).toBe(200);
    const appointmentId: string = (await bookRes.json()).appointment.id;

    let lead = await getLead(page, leadId);
    const confirmations = lead.communications.filter((c) => c.type === "appointment_confirmation");
    expect(confirmations.length).toBeGreaterThan(0);
    for (const c of confirmations) {
      expect(c.status).toBe("accepted");
      expect(c.leadId).toBe(leadId);
      expect(c.companyId).toBe(lead.companyId);
      expect(c.appointmentId).toBe(appointmentId);
    }

    // 2. Reschedule — should persist a SENT appointment_rescheduled record.
    const nextSlot = await firstAvailableSlot(page, leadId, leadToken);
    const rescheduleRes = await page.request.patch(`/api/appointments/${appointmentId}`, {
      data: { action: "reschedule", start: nextSlot.start, end: nextSlot.end },
    });
    expect(rescheduleRes.status()).toBe(200);

    lead = await getLead(page, leadId);
    const rescheduled = lead.communications.filter((c) => c.type === "appointment_rescheduled");
    expect(rescheduled.length).toBe(1);
    expect(rescheduled[0].status).toBe("accepted");
    expect(rescheduled[0].appointmentId).toBe(appointmentId);

    // 3. Cancel — should persist a SENT appointment_cancelled record.
    const cancelRes = await page.request.patch(`/api/appointments/${appointmentId}`, {
      data: { action: "cancel" },
    });
    expect(cancelRes.status()).toBe(200);

    lead = await getLead(page, leadId);
    const cancelled = lead.communications.filter((c) => c.type === "appointment_cancelled");
    expect(cancelled.length).toBe(1);
    expect(cancelled[0].status).toBe("accepted");
    expect(cancelled[0].appointmentId).toBe(appointmentId);
  });

  test("a suppressed contact's booking confirmation is persisted as BLOCKED, not sent", async ({ page }) => {
    const stamp = Date.now();

    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
    await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const { leadId, leadToken } = await createSqlLead(page, `e2e-comm-log-blocked-${stamp}`, {
      firstName: "Sam",
      lastName: "Suppressed",
      email: `sam.suppressed.${stamp}@example.com`,
      phone: "+15125550181",
    });

    const optOutRes = await page.request.patch(`/api/leads/${leadId}`, { data: { optedOut: true } });
    expect(optOutRes.status()).toBe(200);

    // Booking still succeeds (opting out blocks marketing sends, not the
    // ability to book/manage an appointment) but the confirmation send
    // must be blocked and logged as such.
    const slot = await firstAvailableSlot(page, leadId, leadToken);
    const bookRes = await page.request.post("/api/appointments", {
      data: { leadId, leadToken, start: slot.start, end: slot.end },
    });
    expect(bookRes.status()).toBe(200);

    const lead = await getLead(page, leadId);
    const confirmations = lead.communications.filter((c) => c.type === "appointment_confirmation");
    expect(confirmations.length).toBeGreaterThan(0);
    for (const c of confirmations) {
      expect(c.status).toBe("suppressed");
      expect(c.blockedReason).toBeTruthy();
    }
  });
});
