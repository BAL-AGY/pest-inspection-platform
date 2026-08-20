import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addLocalCalendarDays,
  localDateKey,
  localDateTimeToInstant,
  localWeekday,
  parseLocalDateKey,
  zonedDateTimeParts,
} from "../src/lib/timezone";

const CHICAGO = "America/Chicago";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

async function createSqlLead(request: APIRequestContext, visitorId: string) {
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
    const response = await request.post("/api/leads", {
      data: { visitorId, leadId, leadToken, answers },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const response = await request.post("/api/leads", {
    data: {
      visitorId,
      leadId,
      leadToken,
      contact: {
        firstName: "Timezone",
        lastName: "Test",
        email: `${visitorId}@example.com`,
        phone: "+15125550169",
      },
    },
  });
  const body = await response.json();
  return { leadId: body.lead.id as string, leadToken: body.leadToken as string };
}

function instantOnLocalDate(dateKey: string, hour: number) {
  return localDateTimeToInstant({ ...parseLocalDateKey(dateKey), hour, minute: 0 }, CHICAGO)!;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("booking and rescheduling enforce the company-local calendar", async ({ page }) => {
  const visitorId = `timezone-route-${Date.now()}`;
  const lead = await createSqlLead(page.request, visitorId);
  const availability = await page.request.get(`/api/availability?leadId=${lead.leadId}&days=30`, {
    headers: { "X-Funnel-Token": lead.leadToken },
  });
  expect(availability.status()).toBe(200);
  const availabilityBody = await availability.json();
  expect(availabilityBody.timeZone).toBe(CHICAGO);
  const validSlot = availabilityBody.slots[0] as { start: string; end: string };
  expect(zonedDateTimeParts(new Date(validSlot.start), CHICAGO).hour).toBeGreaterThanOrEqual(8);

  const localBusinessDate = localDateKey(new Date(validSlot.start), CHICAGO);
  for (const maliciousStart of [
    instantOnLocalDate(localBusinessDate, 7),
    instantOnLocalDate(localBusinessDate, 18),
  ]) {
    const response = await page.request.post("/api/appointments", {
      data: { leadId: lead.leadId, leadToken: lead.leadToken, start: maliciousStart.toISOString() },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: "not_bookable" });
  }

  let sundayKey = localBusinessDate;
  while (localWeekday(sundayKey) !== 0) sundayKey = addLocalCalendarDays(sundayKey, 1);
  const sunday = await page.request.post("/api/appointments", {
    data: {
      leadId: lead.leadId,
      leadToken: lead.leadToken,
      start: instantOnLocalDate(sundayKey, 10).toISOString(),
    },
  });
  expect(sunday.status()).toBe(400);

  const booked = await page.request.post("/api/appointments", {
    data: { leadId: lead.leadId, leadToken: lead.leadToken, start: validSlot.start },
  });
  expect(booked.status()).toBe(200);
  const appointment = (await booked.json()).appointment as { id: string; scheduledStart: string };

  await login(page);
  const invalidReschedule = await page.request.patch(`/api/appointments/${appointment.id}`, {
    data: { action: "reschedule", start: instantOnLocalDate(localBusinessDate, 2).toISOString() },
  });
  expect(invalidReschedule.status()).toBe(400);

  const stored = await page.request.get(`/api/leads/${lead.leadId}`);
  const storedBody = await stored.json();
  const unchanged = storedBody.lead.appointments.find(
    (candidate: { id: string }) => candidate.id === appointment.id,
  );
  expect(new Date(unchanged.scheduledStart).toISOString()).toBe(
    new Date(appointment.scheduledStart).toISOString(),
  );
});
