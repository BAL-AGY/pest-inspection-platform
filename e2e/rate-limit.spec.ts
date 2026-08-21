import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

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
        firstName: "Rate",
        lastName: "Limit",
        email: `${visitorId}@example.com`,
        phone: "+15125550198",
      },
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { leadId: body.lead.id as string, leadToken: body.leadToken as string };
}

test.describe("public API rate limiting", () => {
  test("normal lead creation succeeds; excessive creation is isolated and creates no row when limited", async ({
    request,
  }) => {
    const stamp = Date.now();
    const limitedVisitor = `rate-lead-${stamp}`;

    const normal = await request.post("/api/leads", {
      data: { visitorId: limitedVisitor, answers: { zipCode: "73301" } },
    });
    expect(normal.status()).toBe(200);

    // leadCreate permits six new-lead requests per visitor per hour.
    for (let i = 1; i < 6; i++) {
      const response = await request.post("/api/leads", {
        data: { visitorId: limitedVisitor, answers: { zipCode: "73301" } },
      });
      expect(response.status()).toBe(200);
    }
    const rowsBeforeLimitedRequest = await prisma.lead.count({ where: { visitorId: limitedVisitor } });

    const limited = await request.post("/api/leads", {
      data: { visitorId: limitedVisitor, answers: { zipCode: "73301" } },
    });
    expect(limited.status()).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    const retryAfter = Number(limited.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await prisma.lead.count({ where: { visitorId: limitedVisitor } })).toBe(
      rowsBeforeLimitedRequest,
    );

    const isolatedVisitor = `rate-lead-isolated-${stamp}`;
    const isolated = await request.post("/api/leads", {
      data: { visitorId: isolatedVisitor, answers: { zipCode: "73301" } },
    });
    expect(isolated.status()).toBe(200);
  });

  test("normal tracking succeeds; excessive tracking returns 429 without another event row", async ({
    request,
  }) => {
    const visitorId = `rate-track-${Date.now()}`;
    for (let i = 0; i < 120; i++) {
      const response = await request.post("/api/track", {
        data: {
          visitorId,
          eventType: "landing_page_view",
          url: "http://localhost:3000/?utm_source=rate-test",
          analyticsSessionId: `rate-${i}`, eventKey: `view-${i}`,
        },
      });
      expect(response.status()).toBe(200);
    }
    const rowsBeforeLimitedRequest = await prisma.funnelEvent.count({ where: { visitorId } });
    const limited = await request.post("/api/track", {
      data: { visitorId, eventType: "landing_page_view", url: "http://localhost:3000/", analyticsSessionId: "limited", eventKey: "view" },
    });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(await prisma.funnelEvent.count({ where: { visitorId } })).toBe(rowsBeforeLimitedRequest);
  });

  test("normal booking succeeds; repeated attempts are limited before another appointment is written", async ({
    request,
  }) => {
    const visitorId = `rate-book-${Date.now()}`;
    const lead = await createSqlLead(request, visitorId);
    const availability = await request.get(`/api/availability?leadId=${lead.leadId}`, {
      headers: { "X-Funnel-Token": lead.leadToken },
    });
    expect(availability.status()).toBe(200);
    const slot = (await availability.json()).slots[0] as { start: string; end: string };

    const booked = await request.post("/api/appointments", {
      data: { ...lead, start: slot.start, end: slot.end },
    });
    expect(booked.status()).toBe(200);

    // Eleven more attempts consume the allowed booking budget; their normal
    // double-booking responses prove rate limiting does not replace the DB guard.
    for (let i = 1; i < 12; i++) {
      const response = await request.post("/api/appointments", {
        data: { ...lead, start: slot.start, end: slot.end },
      });
      expect(response.status()).toBe(409);
    }
    const rowsBeforeLimitedRequest = await prisma.appointment.count({
      where: { leadId: lead.leadId },
    });
    const limited = await request.post("/api/appointments", {
      data: { ...lead, start: slot.start, end: slot.end },
    });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(await prisma.appointment.count({ where: { leadId: lead.leadId } })).toBe(
      rowsBeforeLimitedRequest,
    );
  });
});
