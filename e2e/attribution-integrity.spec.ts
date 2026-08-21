import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("tracking ignores stale or cross-visitor lead IDs without failing the event write", async ({ request }) => {
  const stamp = Date.now();
  const visitorId = `attribution-owner-${stamp}`;
  const otherVisitorId = `attribution-other-${stamp}`;
  const created = await request.post("/api/leads", {
    data: { visitorId, answers: { zipCode: "73301" } },
  });
  expect(created.status()).toBe(200);
  const createdBody = await created.json();
  const leadId = createdBody.lead.id as string;
  const leadToken = createdBody.leadToken as string;

  const crossVisitor = await request.post("/api/track", {
    data: {
      visitorId: otherVisitorId,
      leadId,
      leadToken,
      eventType: "funnel_started",
      url: "http://localhost:3000/inspection?utm_source=google&utm_campaign=integrity",
      analyticsSessionId: `cross-${stamp}`, eventKey: "start",
    },
  });
  expect(crossVisitor.status()).toBe(200);
  const crossVisitorBody = await crossVisitor.json();
  expect(await prisma.funnelEvent.findUniqueOrThrow({ where: { id: crossVisitorBody.id } }))
    .toMatchObject({ leadId: null, visitorId: otherVisitorId, source: "google", campaign: "integrity" });

  const stale = await request.post("/api/track", {
    data: {
      visitorId,
      leadId: `missing-${stamp}`,
      eventType: "funnel_started",
      url: "http://localhost:3000/inspection",
      analyticsSessionId: `stale-${stamp}`, eventKey: "start",
    },
  });
  expect(stale.status()).toBe(200);
  expect(await prisma.funnelEvent.findUniqueOrThrow({ where: { id: (await stale.json()).id } }))
    .toMatchObject({ leadId: null, visitorId });

  const owned = await request.post("/api/track", {
    data: {
      visitorId,
      leadId,
      leadToken,
      eventType: "funnel_started",
      url: "http://localhost:3000/inspection",
      analyticsSessionId: `owned-${stamp}`, eventKey: "start",
    },
  });
  expect(owned.status()).toBe(200);
  expect(await prisma.funnelEvent.findUniqueOrThrow({ where: { id: (await owned.json()).id } }))
    .toMatchObject({ leadId, visitorId });
});
