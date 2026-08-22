import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * docs/GOAL_AUDIT.md Critical Path item 21: two concurrent `POST
 * /api/leads` calls with no `leadId` (same `visitorId`) used to create
 * two separate `Lead` rows for what is really one duplicate submission
 * (double-click, network retry) from the same page load — a real but
 * narrow data-hygiene bug with no cross-visitor security impact, found
 * during the prior autonomous session and deliberately left unfixed
 * pending review, since the obvious fix (reusing `visitorId` to collapse
 * concurrent creates) is structurally the same shape as the exact hijack
 * vector Step 17 closed.
 *
 * The actual fix (src/app/api/leads/route.ts, `Lead.creationNonce` in
 * prisma/schema.prisma): the client generates a fresh, single-use,
 * unguessable idempotency key once per page load and sends it only on
 * the very first "no leadId" request. A database-level unique
 * constraint on `creationNonce` guarantees at most one Lead row is ever
 * created per nonce; the loser of a race catches the constraint
 * violation and returns the winner's row instead of erroring. This is
 * NOT a visitorId-based lookup — a stranger who merely knows or guesses
 * another visitor's `visitorId` still cannot attach to their lead,
 * proven below alongside the two positive race scenarios.
 */

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("two truly concurrent creates with the same nonce collapse onto exactly one Lead row", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-race-same-nonce-${stamp}`;
  const creationNonce = `nonce-${stamp}-${Math.random().toString(36).slice(2)}`;

  const [r1, r2] = await Promise.all([
    page.request.post("/api/leads", {
      data: { visitorId, leadId: null, leadToken: null, creationNonce, answers: { zipCode: "73301" } },
    }),
    page.request.post("/api/leads", {
      data: { visitorId, leadId: null, leadToken: null, creationNonce, answers: { zipCode: "73301" } },
    }),
  ]);

  expect(r1.ok()).toBe(true);
  expect(r2.ok()).toBe(true);
  const b1 = await r1.json();
  const b2 = await r2.json();

  // Same underlying row, not two.
  expect(b1.lead.id).toBe(b2.lead.id);

  const rows = await prisma.lead.count({ where: { creationNonce } });
  expect(rows).toBe(1);

  // Both callers are the legitimate same-origin client (that's the whole
  // premise of a same-nonce race) — both of their tokens must actually
  // work for continuing the one real lead, not just the first responder's.
  for (const body of [b1, b2]) {
    const continueRes = await page.request.post("/api/leads", {
      data: { visitorId, leadId: body.lead.id, leadToken: body.leadToken, answers: { isHomeowner: true } },
    });
    expect(continueRes.ok()).toBe(true);
    expect((await continueRes.json()).lead.id).toBe(b1.lead.id);
  }
});

test("two concurrent creates with different nonces (genuinely different page loads) still create two separate leads", async ({
  page,
}) => {
  const stamp = Date.now();
  const visitorId = `e2e-race-diff-nonce-${stamp}`;

  const [r1, r2] = await Promise.all([
    page.request.post("/api/leads", {
      data: { visitorId, leadId: null, leadToken: null, creationNonce: `nonce-a-${stamp}`, answers: { zipCode: "73301" } },
    }),
    page.request.post("/api/leads", {
      data: { visitorId, leadId: null, leadToken: null, creationNonce: `nonce-b-${stamp}`, answers: { zipCode: "73301" } },
    }),
  ]);

  expect(r1.ok()).toBe(true);
  expect(r2.ok()).toBe(true);
  const b1 = await r1.json();
  const b2 = await r2.json();

  expect(b1.lead.id).not.toBe(b2.lead.id);
});

test("a caller who supplies a stranger's visitorId without their creationNonce never attaches to the stranger's lead", async ({
  page,
}) => {
  const stamp = Date.now();
  const victimVisitorId = `e2e-race-victim-${stamp}`;
  const victimNonce = `nonce-victim-${stamp}`;

  const victimRes = await page.request.post("/api/leads", {
    data: { visitorId: victimVisitorId, leadId: null, leadToken: null, creationNonce: victimNonce, answers: { zipCode: "73301" } },
  });
  const victimBody = await victimRes.json();

  // Attacker knows/guesses the victim's visitorId but not their
  // single-use nonce (a fresh, unguessable value never exposed anywhere
  // visitorId is) — omits leadId entirely, exactly the Step 17 scenario.
  const attackerRes = await page.request.post("/api/leads", {
    data: { visitorId: victimVisitorId, leadId: null, leadToken: null, answers: { zipCode: "73301" } },
  });
  const attackerBody = await attackerRes.json();

  expect(attackerRes.ok()).toBe(true);
  expect(attackerBody.lead.id).not.toBe(victimBody.lead.id);

  const rows = await prisma.lead.findMany({ where: { visitorId: victimVisitorId } });
  expect(rows.length).toBe(2);
});
