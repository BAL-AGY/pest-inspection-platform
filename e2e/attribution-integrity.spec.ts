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
  const leadId = (await created.json()).lead.id as string;

  const crossVisitor = await request.post("/api/track", {
    data: {
      visitorId: otherVisitorId,
      leadId,
      eventType: "assessment_start",
      url: "http://localhost:3000/inspection?utm_source=google&utm_campaign=integrity",
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
      eventType: "assessment_start",
      url: "http://localhost:3000/inspection",
    },
  });
  expect(stale.status()).toBe(200);
  expect(await prisma.funnelEvent.findUniqueOrThrow({ where: { id: (await stale.json()).id } }))
    .toMatchObject({ leadId: null, visitorId });

  const owned = await request.post("/api/track", {
    data: {
      visitorId,
      leadId,
      eventType: "assessment_start",
      url: "http://localhost:3000/inspection",
    },
  });
  expect(owned.status()).toBe(200);
  expect(await prisma.funnelEvent.findUniqueOrThrow({ where: { id: (await owned.json()).id } }))
    .toMatchObject({ leadId, visitorId });
});
