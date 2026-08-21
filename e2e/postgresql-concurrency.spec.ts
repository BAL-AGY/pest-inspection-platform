import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { localDateKey } from "../src/lib/timezone";
import { appointmentCompanyDayRange } from "../src/lib/scheduling";

const prisma = new PrismaClient();
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";
const ACTIVE_STATUSES = ["booked", "rescheduled"];

function primaryCompany() {
  return prisma.company.findUniqueOrThrow({ where: { slug: "demo-pest-control" } });
}

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL?.startsWith("postgresql://")) {
    throw new Error("PostgreSQL concurrency tests require a postgresql:// DATABASE_URL");
  }
  const result = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
  expect(result[0].version).toContain("PostgreSQL");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

interface OwnedLead {
  leadId: string;
  leadToken: string;
}

async function createSqlLead(page: Page, marker: string): Promise<OwnedLead> {
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
    const response = await page.request.post("/api/leads", {
      data: { visitorId: marker, leadId, leadToken, answers },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  const response = await page.request.post("/api/leads", {
    data: {
      visitorId: marker,
      leadId,
      leadToken,
      contact: {
        firstName: "Postgres",
        lastName: "Concurrency",
        email: `${marker}@example.com`,
        phone: `+1512${marker.replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
      },
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { leadId: body.lead.id, leadToken: body.leadToken };
}

async function availableSlots(page: Page, lead: OwnedLead, days = 180) {
  const response = await page.request.get(
    `/api/availability?leadId=${lead.leadId}&days=${days}`,
    { headers: { "X-Funnel-Token": lead.leadToken } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).slots as Array<{ start: string; end: string }>;
}

async function emptyFarDayWithSlots(
  slots: Array<{ start: string; end: string }>,
  companyId: string,
  timeZone: string,
  count: number,
  excludedKeys = new Set<string>(),
) {
  const occupied = new Set(
    (
      await prisma.appointment.findMany({
        where: { companyId, status: { in: ACTIVE_STATUSES } },
        select: { scheduledStart: true },
      })
    ).map((appointment) => localDateKey(appointment.scheduledStart, timeZone)),
  );
  const days = new Map<string, Array<{ start: string; end: string }>>();
  for (const slot of slots.slice().reverse()) {
    const key = localDateKey(new Date(slot.start), timeZone);
    if (occupied.has(key) || excludedKeys.has(key)) continue;
    const day = days.get(key) ?? [];
    day.push(slot);
    days.set(key, day);
    if (day.length >= count) return day.slice(0, count);
  }
  throw new Error(`No company-local day has ${count} available slots`);
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("PostgreSQL baseline includes the active-slot partial unique index", async () => {
  const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'Appointment_companyId_scheduledStart_active_key'
  `;
  expect(indexes).toHaveLength(1);
  expect(indexes[0].indexdef).toContain("UNIQUE INDEX");
  expect(indexes[0].indexdef).toContain("status");
});

test("simultaneous same-slot route requests persist exactly one active appointment", async ({ page }) => {
  const stamp = Date.now();
  const first = await createSqlLead(page, `pg-same-a-${stamp}`);
  const second = await createSqlLead(page, `pg-same-b-${stamp}`);
  const company = await primaryCompany();
  const target = (await availableSlots(page, first)).at(-1)!;

  const responses = await Promise.all([
    page.request.post("/api/appointments", {
      data: { ...first, start: target.start, end: target.end },
    }),
    page.request.post("/api/appointments", {
      data: { ...second, start: target.start, end: target.end },
    }),
  ]);

  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  await expect(
    prisma.appointment.count({
      where: {
        companyId: company.id,
        scheduledStart: new Date(target.start),
        status: { in: ACTIVE_STATUSES },
      },
    }),
  ).resolves.toBe(1);
});

test("serializable retries prevent concurrent different-slot bookings from exceeding local-day capacity", async ({ page }) => {
  const stamp = Date.now();
  const company = await primaryCompany();
  const originalCapacity = company.maxDailyInspections;
  const leads = await Promise.all(
    Array.from({ length: 4 }, (_, index) => createSqlLead(page, `pg-cap-${stamp}-${index}`)),
  );
  const slots = await emptyFarDayWithSlots(
    await availableSlots(page, leads[0]),
    company.id,
    company.timezone,
    4,
  );
  const dayKey = localDateKey(new Date(slots[0].start), company.timezone);

  try {
    await prisma.company.update({ where: { id: company.id }, data: { maxDailyInspections: 3 } });
    await prisma.appointment.createMany({
      data: slots.slice(0, 2).map((slot, index) => ({
        companyId: company.id,
        leadId: leads[index].leadId,
        scheduledStart: new Date(slot.start),
        scheduledEnd: new Date(slot.end),
        status: "booked",
      })),
    });

    const responses = await Promise.all(
      slots.slice(2).map((slot, index) =>
        page.request.post("/api/appointments", {
          data: { ...leads[index + 2], start: slot.start, end: slot.end },
        }),
      ),
    );
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status() === 409)!;
    expect((await rejected.json()).error).toBe("capacity_exceeded");

    const persisted = await prisma.appointment.findMany({
      where: { companyId: company.id, status: { in: ACTIVE_STATUSES } },
      select: { scheduledStart: true },
    });
    expect(
      persisted.filter(
        (appointment) => localDateKey(appointment.scheduledStart, company.timezone) === dayKey,
      ),
    ).toHaveLength(3);
  } finally {
    await prisma.company.update({
      where: { id: company.id },
      data: { maxDailyInspections: originalCapacity },
    });
  }
});

test("concurrent reschedules cannot exceed destination capacity and a failed move preserves its source", async ({ page }) => {
  const stamp = Date.now();
  const company = await primaryCompany();
  const originalCapacity = company.maxDailyInspections;
  const leads = await Promise.all(
    Array.from({ length: 4 }, (_, index) => createSqlLead(page, `pg-move-${stamp}-${index}`)),
  );
  const allSlots = await availableSlots(page, leads[0]);
  const destination = await emptyFarDayWithSlots(
    allSlots,
    company.id,
    company.timezone,
    4,
  );
  const source = await emptyFarDayWithSlots(
    allSlots,
    company.id,
    company.timezone,
    2,
    new Set([localDateKey(new Date(destination[0].start), company.timezone)]),
  );

  const destinationExisting = await prisma.appointment.createMany({
    data: destination.slice(0, 2).map((slot, index) => ({
      companyId: company.id,
      leadId: leads[index].leadId,
      scheduledStart: new Date(slot.start),
      scheduledEnd: new Date(slot.end),
      status: "booked",
    })),
  });
  expect(destinationExisting.count).toBe(2);
  const moving = await Promise.all(
    source.slice(0, 2).map((slot, index) =>
      prisma.appointment.create({
        data: {
          companyId: company.id,
          leadId: leads[index + 2].leadId,
          scheduledStart: new Date(slot.start),
          scheduledEnd: new Date(slot.end),
          status: "booked",
        },
      }),
    ),
  );
  const originalStarts = new Map(moving.map((appointment) => [appointment.id, appointment.scheduledStart]));

  try {
    await prisma.company.update({ where: { id: company.id }, data: { maxDailyInspections: 3 } });
    await loginAsOwner(page);
    const responses = await Promise.all(
      moving.map((appointment, index) =>
        page.request.patch(`/api/appointments/${appointment.id}`, {
          data: { action: "reschedule", start: destination[index + 2].start },
        }),
      ),
    );
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status() === 409)!;
    expect((await rejected.json()).error).toBe("capacity_exceeded");

    const after = await prisma.appointment.findMany({ where: { id: { in: moving.map((item) => item.id) } } });
    const moved = after.filter((appointment) =>
      destination.slice(2).some((slot) => appointment.scheduledStart.getTime() === new Date(slot.start).getTime()),
    );
    const preserved = after.filter((appointment) =>
      appointment.scheduledStart.getTime() === originalStarts.get(appointment.id)?.getTime(),
    );
    expect(moved).toHaveLength(1);
    expect(preserved).toHaveLength(1);
  } finally {
    await prisma.company.update({
      where: { id: company.id },
      data: { maxDailyInspections: originalCapacity },
    });
  }
});

test("cancellation releases both the slot and daily capacity; inactive rows do not block reuse", async ({ page }) => {
  const stamp = Date.now();
  const company = await primaryCompany();
  const originalCapacity = company.maxDailyInspections;
  const first = await createSqlLead(page, `pg-cancel-a-${stamp}`);
  const second = await createSqlLead(page, `pg-cancel-b-${stamp}`);
  const target = (
    await emptyFarDayWithSlots(
      await availableSlots(page, first),
      company.id,
      company.timezone,
      1,
    )
  )[0];

  try {
    await prisma.company.update({ where: { id: company.id }, data: { maxDailyInspections: 1 } });
    const booked = await page.request.post("/api/appointments", {
      data: { ...first, start: target.start, end: target.end },
    });
    expect(booked.status()).toBe(200);
    const appointmentId = (await booked.json()).appointment.id as string;

    await loginAsOwner(page);
    const cancelled = await page.request.patch(`/api/appointments/${appointmentId}`, {
      data: { action: "cancel" },
    });
    expect(cancelled.status()).toBe(200);

    const replacement = await page.request.post("/api/appointments", {
      data: { ...second, start: target.start, end: target.end },
    });
    expect(replacement.status()).toBe(200);
    const rows = await prisma.appointment.findMany({
      where: { companyId: company.id, scheduledStart: new Date(target.start) },
      select: { status: true },
    });
    expect(rows.map((row) => row.status).sort()).toEqual(["booked", "cancelled"]);
  } finally {
    await prisma.company.update({
      where: { id: company.id },
      data: { maxDailyInspections: originalCapacity },
    });
  }
});

test("active-slot constraints and capacity are isolated by company", async () => {
  const stamp = Date.now();
  const primary = await primaryCompany();
  const other = await prisma.company.create({
    data: {
      name: "Postgres Isolation Co",
      slug: `pg-isolation-${stamp}`,
      timezone: primary.timezone,
      serviceZipCodes: primary.serviceZipCodes,
      supportedPests: primary.supportedPests,
      businessHours: primary.businessHours,
      scoringRules: primary.scoringRules,
      maxDailyInspections: 1,
    },
  });
  const [primaryLead, otherLead] = await Promise.all([
    prisma.lead.create({ data: { companyId: primary.id, visitorId: `pg-tenant-a-${stamp}` } }),
    prisma.lead.create({ data: { companyId: other.id, visitorId: `pg-tenant-b-${stamp}` } }),
  ]);
  const future = new Date();
  const start = new Date(
    Date.UTC(
      future.getUTCFullYear() + 10,
      future.getUTCMonth(),
      future.getUTCDate(),
    ) +
      (stamp % (30 * 60 * 1000)),
  );
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  await expect(
    Promise.all([
      prisma.appointment.create({
        data: { companyId: primary.id, leadId: primaryLead.id, scheduledStart: start, scheduledEnd: end },
      }),
      prisma.appointment.create({
        data: { companyId: other.id, leadId: otherLead.id, scheduledStart: start, scheduledEnd: end },
      }),
    ]),
  ).resolves.toHaveLength(2);

  // Shortly after 00:00 UTC is still the previous company-local day in Chicago. Prove the
  // absolute TIMESTAMPTZ row falls inside the application-derived local-day
  // range rather than a UTC/server-midnight range.
  expect(localDateKey(start, primary.timezone)).not.toBe(start.toISOString().slice(0, 10));
  const localDay = appointmentCompanyDayRange(start, primary.timezone);
  await expect(
    prisma.appointment.count({
      where: {
        companyId: primary.id,
        scheduledStart: { gte: localDay.start, lt: localDay.end },
      },
    }),
  ).resolves.toBe(1);
});
