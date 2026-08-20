import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Adversarial coverage for the three related fixes in this pass (see
 * docs/GOAL_AUDIT.md Critical Path):
 *   1. Public lead ownership / IDOR protection (src/lib/funnel-capability.ts)
 *   2. Atomic double-booking / capacity protection (partial unique DB index
 *      + in-transaction re-check, src/app/api/appointments/route.ts)
 *   3. Server-side duration/slot/inspector validation
 *
 * These exercise the real, live routes against the real dev DB — not just
 * the underlying pure functions (src/lib/scheduling.test.ts already covers
 * those in isolation) — because the actual vulnerability lived in the
 * route wiring, not the pure logic. Runs against the real dev server and
 * real SQLite dev database, like the other e2e specs in this repo.
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

interface LeadResult {
  leadId: string;
  leadToken: string;
}

async function createSqlLead(
  page: Page,
  visitorId: string,
  contact: { firstName: string; lastName: string; email: string; phone: string },
): Promise<LeadResult> {
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

async function availableSlots(page: Page, leadId: string, leadToken: string, days = 30) {
  const r = await page.request.get(`/api/availability?leadId=${leadId}&days=${days}`, {
    headers: { "X-Funnel-Token": leadToken },
  });
  const body = await r.json();
  return (body.slots ?? []) as { start: string; end: string }[];
}

/**
 * Finds a calendar day with at least `minCount` free candidate slots, from
 * live availability, at least `minDaysOut` days from now. Deliberately
 * biased toward the far future: this suite books real appointments into
 * the persistent dev DB and is safely re-run many times across a session
 * (see e2e/full-funnel.spec.ts's note on being re-runnable) — but every
 * *other* test in this repo always books into the *nearest* available
 * slot (`slots[0]`). A capacity-exhaustion test that also books near-term
 * slots would, after enough repeated runs, saturate the whole near-term
 * calendar and starve those other tests of any slot to book at all (this
 * happened once during development — see docs/GOAL_AUDIT.md Step 17).
 * Operating far out keeps this test's footprint permanently isolated from
 * theirs.
 */
function pickDayWithCapacity(
  slots: { start: string; end: string }[],
  minCount: number,
  minDaysOut: number,
) {
  const earliestAllowed = new Date(Date.now() + minDaysOut * 24 * 60 * 60 * 1000);
  const byDay = new Map<string, { start: string; end: string }[]>();
  for (const slot of slots) {
    if (new Date(slot.start) < earliestAllowed) continue;
    const dayKey = slot.start.slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(slot);
  }
  for (const daySlots of byDay.values()) {
    if (daySlots.length >= minCount) return daySlots;
  }
  return null;
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function getLeadAsStaff(page: Page, leadId: string) {
  const r = await page.request.get(`/api/leads/${leadId}`);
  const body = await r.json();
  return body.lead as Record<string, unknown>;
}

test.describe("public lead ownership / IDOR protection", () => {
  test("Visitor A cannot read/mutate Visitor B's lead using B's leadId, and B is unaffected", async ({ page }) => {
    const stamp = Date.now();
    const a = await createSqlLead(page, `e2e-sec-a-${stamp}`, {
      firstName: "Alice",
      lastName: "Owner",
      email: `alice.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const b = await createSqlLead(page, `e2e-sec-b-${stamp}`, {
      firstName: "Bob",
      lastName: "Victim",
      email: `bob.${stamp}@example.com`,
      phone: `+1512555${String(stamp + 1).slice(-4)}`,
    });

    // A tries to rewrite B's contact info using B's leadId, with A's own
    // visitorId and no valid capability token for B's lead.
    const attack = await page.request.post("/api/leads", {
      data: {
        visitorId: `e2e-sec-a-${stamp}`,
        leadId: b.leadId,
        leadToken: null,
        contact: { firstName: "Hacked", lastName: "Attacker", email: "attacker@evil.com", phone: "+15550000000" },
        smsConsent: true,
        emailConsent: true,
      },
    });
    expect(attack.status()).toBe(403);

    await loginAsOwner(page);
    const bLead = await getLeadAsStaff(page, b.leadId);
    expect(bLead.firstName).toBe("Bob");
    expect(bLead.email).toBe(`bob.${stamp}@example.com`);

    // A's own lead must be completely untouched by the failed attempt too.
    const aLead = await getLeadAsStaff(page, a.leadId);
    expect(aLead.firstName).toBe("Alice");
  });

  test("a caller cannot continue/mutate an existing lead merely by supplying its visitorId and omitting leadId/token", async ({
    page,
  }) => {
    // This is the specific bypass an independent audit found in the
    // Step 15 implementation: POST /api/leads' "no leadId" branch used to
    // look up ANY existing lead by visitorId alone (no token check) and
    // both mutate it and hand back a fresh, valid token for it. Fixed by
    // treating "no leadId" as *always* meaning "create a new lead" —
    // never as an implicit, unauthenticated continuation of whatever lead
    // already exists for that visitorId.
    const stamp = Date.now();
    const victimVisitorId = `e2e-sec-visitoronly-${stamp}`;
    const victim = await createSqlLead(page, victimVisitorId, {
      firstName: "Victim",
      lastName: "Original",
      email: `victim.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    // Attacker knows/obtains the victim's visitorId (e.g. it's the value
    // that was used to create the lead in the first place — leaked via a
    // log, a shared device, or simply guessed) but has no leadId/token.
    const attack = await page.request.post("/api/leads", {
      data: {
        visitorId: victimVisitorId,
        contact: { firstName: "Hijacked", lastName: "Attacker", email: "attacker2@evil.com", phone: "+15550000001" },
        smsConsent: true,
        emailConsent: true,
      },
    });
    // Succeeds — but only as the creation of a brand-new, unrelated lead.
    // It must never be treated as continuation of the victim's lead, and
    // no token for the victim's lead may be handed back.
    expect(attack.status()).toBe(200);
    const attackBody = await attack.json();
    expect(attackBody.lead.id).not.toBe(victim.leadId);

    await loginAsOwner(page);
    const victimLead = await getLeadAsStaff(page, victim.leadId);
    expect(victimLead.firstName).toBe("Victim");
    expect(victimLead.email).toBe(`victim.${stamp}@example.com`);

    // The attacker's freshly issued token must not work against the
    // victim's real lead either.
    const followUp = await page.request.post("/api/leads", {
      data: {
        visitorId: victimVisitorId,
        leadId: victim.leadId,
        leadToken: attackBody.leadToken,
        contact: { firstName: "StillHijacked" },
      },
    });
    expect(followUp.status()).toBe(403);
  });

  test("a valid token for one lead cannot be used to continue a different lead via POST /api/leads", async ({ page }) => {
    const stamp = Date.now();
    const a = await createSqlLead(page, `e2e-sec-wrongtoken-a-${stamp}`, {
      firstName: "Token",
      lastName: "OwnerA",
      email: `tokena.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const b = await createSqlLead(page, `e2e-sec-wrongtoken-b-${stamp}`, {
      firstName: "Token",
      lastName: "OwnerB",
      email: `tokenb.${stamp}@example.com`,
      phone: `+1512555${String(stamp + 1).slice(-4)}`,
    });

    const attack = await page.request.post("/api/leads", {
      data: {
        visitorId: `e2e-sec-wrongtoken-a-${stamp}`,
        leadId: b.leadId,
        leadToken: a.leadToken, // valid, but for A's lead, not B's
        contact: { firstName: "Nope" },
      },
    });
    expect(attack.status()).toBe(403);

    await loginAsOwner(page);
    const bLead = await getLeadAsStaff(page, b.leadId);
    expect(bLead.firstName).toBe("Token");
    expect(bLead.lastName).toBe("OwnerB");
  });

  test("Visitor A cannot book using Visitor B's lead", async ({ page }) => {
    const stamp = Date.now();
    const a = await createSqlLead(page, `e2e-sec-book-a-${stamp}`, {
      firstName: "Casey",
      lastName: "Attacker",
      email: `casey.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const b = await createSqlLead(page, `e2e-sec-book-b-${stamp}`, {
      firstName: "Drew",
      lastName: "Victim",
      email: `drew.${stamp}@example.com`,
      phone: `+1512555${String(stamp + 1).slice(-4)}`,
    });

    const slots = await availableSlots(page, b.leadId, b.leadToken);
    expect(slots.length).toBeGreaterThan(0);

    // A attempts to book an inspection consuming B's lead/slot, presenting
    // A's own valid token for A's lead alongside B's leadId — the token
    // must be checked against the *targeted* lead, not merely "some" valid
    // token the caller happens to hold.
    const attack = await page.request.post("/api/appointments", {
      data: { leadId: b.leadId, leadToken: a.leadToken, start: slots[0].start, end: slots[0].end },
    });
    expect(attack.status()).toBe(403);
  });

  test("missing or malformed capability tokens are rejected", async ({ page }) => {
    const stamp = Date.now();
    const a = await createSqlLead(page, `e2e-sec-missing-${stamp}`, {
      firstName: "Jamie",
      lastName: "Token",
      email: `jamie.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    // Continuation with leadId but no token at all.
    const noToken = await page.request.post("/api/leads", {
      data: { visitorId: `e2e-sec-missing-${stamp}`, leadId: a.leadId, contact: { firstName: "Nope" } },
    });
    expect(noToken.status()).toBe(403);

    // Continuation with a garbage/malformed token.
    const badToken = await page.request.post("/api/leads", {
      data: {
        visitorId: `e2e-sec-missing-${stamp}`,
        leadId: a.leadId,
        leadToken: "not-a-real-token",
        contact: { firstName: "Nope" },
      },
    });
    expect(badToken.status()).toBe(403);

    // Booking with no token is a 400 (zod requires it), not a silent pass.
    const slots = await availableSlots(page, a.leadId, a.leadToken);
    const bookNoToken = await page.request.post("/api/appointments", {
      data: { leadId: a.leadId, start: slots[0].start, end: slots[0].end },
    });
    expect(bookNoToken.status()).toBe(400);

    // Availability with no token header is rejected too.
    const availNoToken = await page.request.get(`/api/availability?leadId=${a.leadId}`);
    expect(availNoToken.status()).toBe(403);
  });

  test("a legitimate visitor can continue their own funnel and book their own inspection", async ({ page }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-legit-${stamp}`, {
      firstName: "Morgan",
      lastName: "Real",
      email: `morgan.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    // Legitimate continuation with the correct token — e.g. updating an
    // answer after contact capture.
    const continued = await page.request.post("/api/leads", {
      data: {
        visitorId: `e2e-sec-legit-${stamp}`,
        leadId: lead.leadId,
        leadToken: lead.leadToken,
        answers: { timeline: "this_week" },
      },
    });
    expect(continued.status()).toBe(200);
    const continuedBody = await continued.json();
    expect(continuedBody.lead.id).toBe(lead.leadId);

    const slots = await availableSlots(page, lead.leadId, lead.leadToken);
    expect(slots.length).toBeGreaterThan(0);
    const bookRes = await page.request.post("/api/appointments", {
      data: { leadId: lead.leadId, leadToken: lead.leadToken, start: slots[0].start, end: slots[0].end },
    });
    expect(bookRes.status()).toBe(200);
    const bookBody = await bookRes.json();
    expect(bookBody.appointment.leadId).toBe(lead.leadId);
  });
});

test.describe("atomic double-booking / capacity protection", () => {
  test("two genuinely concurrent booking requests for the same slot cannot both succeed", async ({ page }) => {
    const stamp = Date.now();
    const a = await createSqlLead(page, `e2e-sec-race-a-${stamp}`, {
      firstName: "Race",
      lastName: "One",
      email: `race1.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const b = await createSqlLead(page, `e2e-sec-race-b-${stamp}`, {
      firstName: "Race",
      lastName: "Two",
      email: `race2.${stamp}@example.com`,
      phone: `+1512555${String(stamp + 1).slice(-4)}`,
    });

    const slots = await availableSlots(page, a.leadId, a.leadToken);
    expect(slots.length).toBeGreaterThan(0);
    const target = slots[slots.length - 1]; // pick from the tail to avoid colliding with other tests' "first slot"

    const [resA, resB] = await Promise.all([
      page.request.post("/api/appointments", {
        data: { leadId: a.leadId, leadToken: a.leadToken, start: target.start, end: target.end },
      }),
      page.request.post("/api/appointments", {
        data: { leadId: b.leadId, leadToken: b.leadToken, start: target.start, end: target.end },
      }),
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    // Exactly one must succeed (200) and the other must be rejected as a
    // conflict (409) — never both 200.
    expect(statuses).toEqual([200, 409]);
  });

  test("daily capacity cannot be exceeded even by distinct, non-overlapping times", async ({ page }) => {
    const stamp = Date.now();
    const filler = await createSqlLead(page, `e2e-sec-capacity-${stamp}`, {
      firstName: "Capacity",
      lastName: "Filler",
      email: `capacity.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    const company = await prisma.company.findFirstOrThrow();
    const maxDaily = company.maxDailyInspections;

    // 60+ days out and beyond, well clear of the near-term slots every
    // other test in this suite books into (they all take `slots[0]`) —
    // see pickDayWithCapacity's comment.
    const slots = await availableSlots(page, filler.leadId, filler.leadToken, 120);
    const day = pickDayWithCapacity(slots, maxDaily + 1, 60);
    test.skip(!day, "No day with enough free capacity found in the availability window for this run.");
    if (!day) return;

    for (let i = 0; i < maxDaily; i++) {
      const res = await page.request.post("/api/appointments", {
        data: { leadId: filler.leadId, leadToken: filler.leadToken, start: day[i].start, end: day[i].end },
      });
      expect(res.status()).toBe(200);
    }

    // The (maxDaily + 1)th distinct, non-overlapping time on the same day
    // must be rejected purely on capacity grounds.
    const overCapacity = await page.request.post("/api/appointments", {
      data: { leadId: filler.leadId, leadToken: filler.leadToken, start: day[maxDaily].start, end: day[maxDaily].end },
    });
    expect(overCapacity.status()).toBe(409);
    const overCapacityBody = await overCapacity.json();
    expect(overCapacityBody.error).toBe("capacity_exceeded");
  });
});

test.describe("server-side duration/slot/inspector validation", () => {
  test("the server always derives the appointment end from the company's configured duration, regardless of client input", async ({
    page,
  }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-duration-${stamp}`, {
      firstName: "Val",
      lastName: "Idation",
      email: `val.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const company = await prisma.company.findFirstOrThrow();

    const slots = await availableSlots(page, lead.leadId, lead.leadToken);
    const target = slots[0];
    const zeroLength = target.start; // end === start
    const negative = new Date(new Date(target.start).getTime() - 60_000).toISOString(); // end before start
    const veryLong = new Date(new Date(target.start).getTime() + 6 * 3600_000).toISOString(); // +6h

    for (const maliciousEnd of [zeroLength, negative, veryLong, undefined]) {
      const res = await page.request.post("/api/appointments", {
        data: {
          leadId: lead.leadId,
          leadToken: lead.leadToken,
          start: target.start,
          ...(maliciousEnd ? { end: maliciousEnd } : {}),
        },
      });
      // Only the first attempt should ever succeed (same slot reused);
      // once booked, later attempts correctly 409 as double-booked. Either
      // way, if 200, the persisted duration must match the company's
      // configured duration, never the malicious `end`.
      if (res.status() === 200) {
        const body = await res.json();
        const durationMs =
          new Date(body.appointment.scheduledEnd).getTime() - new Date(body.appointment.scheduledStart).getTime();
        expect(durationMs).toBe(company.inspectionDurationMinutes * 60_000);
      } else {
        expect(res.status()).toBe(409);
      }
    }
  });

  test("a start time outside business hours is rejected", async ({ page }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-hours-${stamp}`, {
      firstName: "Off",
      lastName: "Hours",
      email: `offhours.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    const midnight = new Date();
    midnight.setDate(midnight.getDate() + 3);
    midnight.setHours(2, 0, 0, 0); // 2am — outside any configured business hours

    const res = await page.request.post("/api/appointments", {
      data: { leadId: lead.leadId, leadToken: lead.leadToken, start: midnight.toISOString() },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("not_bookable");
  });

  test("a start time that doesn't align to the slot grid is rejected", async ({ page }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-grid-${stamp}`, {
      firstName: "Off",
      lastName: "Grid",
      email: `offgrid.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    const slots = await availableSlots(page, lead.leadId, lead.leadToken);
    const misaligned = new Date(new Date(slots[0].start).getTime() + 7 * 60_000).toISOString(); // +7 minutes

    const res = await page.request.post("/api/appointments", {
      data: { leadId: lead.leadId, leadToken: lead.leadToken, start: misaligned },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("not_bookable");
  });

  test("an inactive inspector cannot be used to book", async ({ page }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-inactive-${stamp}`, {
      firstName: "In",
      lastName: "Active",
      email: `inactive.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });
    const company = await prisma.company.findFirstOrThrow();
    const inactiveInspector = await prisma.inspector.create({
      data: { companyId: company.id, name: "Inactive Inspector", email: `inactive-${stamp}@example.com`, active: false },
    });

    const slots = await availableSlots(page, lead.leadId, lead.leadToken);
    const res = await page.request.post("/api/appointments", {
      data: {
        leadId: lead.leadId,
        leadToken: lead.leadToken,
        start: slots[0].start,
        inspectorId: inactiveInspector.id,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_inspector");
  });

  test("an inspector belonging to another company cannot be used to book", async ({ page }) => {
    const stamp = Date.now();
    const lead = await createSqlLead(page, `e2e-sec-crosstenant-${stamp}`, {
      firstName: "Cross",
      lastName: "Tenant",
      email: `crosstenant.${stamp}@example.com`,
      phone: `+1512555${String(stamp).slice(-4)}`,
    });

    const otherCompany = await prisma.company.create({
      data: {
        name: `Other Co ${stamp}`,
        slug: `other-co-${stamp}`,
        serviceZipCodes: JSON.stringify(["00000"]),
        supportedPests: JSON.stringify(["ants"]),
        businessHours: JSON.stringify({}),
        scoringRules: JSON.stringify([]),
      },
    });
    const otherInspector = await prisma.inspector.create({
      data: { companyId: otherCompany.id, name: "Other Co Inspector", email: `other-${stamp}@example.com`, active: true },
    });

    const slots = await availableSlots(page, lead.leadId, lead.leadToken);
    const res = await page.request.post("/api/appointments", {
      data: {
        leadId: lead.leadId,
        leadToken: lead.leadToken,
        start: slots[0].start,
        inspectorId: otherInspector.id,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_inspector");
  });
});
