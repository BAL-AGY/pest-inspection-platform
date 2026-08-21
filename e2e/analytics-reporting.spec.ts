import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { getDashboardMetrics } from "../src/lib/dashboard-metrics";
import { clearRevenueEvent, recordCustomerOutcomeEvent, recordFunnelEvent, recordRevenueEvent } from "../src/lib/analytics-events";

const prisma = new PrismaClient();
test.afterAll(async () => prisma.$disconnect());

test("public tracking is idempotent, preserves first/last touch, and cannot forge conversions", async ({ request }) => {
  const stamp = Date.now(); const visitorId = `analytics-${stamp}`;
  const first = { visitorId, eventType: "landing_page_view", url: "http://localhost:3000/?utm_source=google&utm_medium=cpc&utm_campaign=first&utm_content=ad-a&gclid=g-1", analyticsSessionId: `s1-${stamp}`, eventKey: "landing" };
  const [firstResponse, concurrentCta] = await Promise.all([
    request.post("/api/track", { data: first }),
    request.post("/api/track", { data: { ...first, eventType: "inspection_cta_clicked", eventKey: "cta" } }),
  ]);
  expect(firstResponse.status()).toBe(200); expect(concurrentCta.status()).toBe(200);
  expect(await prisma.visitorAttribution.count({ where: { visitorId } })).toBe(1);
  const firstId = (await firstResponse.json()).id;
  const retry = await request.post("/api/track", { data: first }); expect((await retry.json()).id).toBe(firstId);
  expect(await prisma.funnelEvent.count({ where: { visitorId, eventType: "landing_page_view" } })).toBe(1);

  const second = await request.post("/api/track", { data: { visitorId, eventType: "funnel_started", url: "http://localhost:3000/inspection?utm_source=facebook&utm_medium=paid-social&utm_campaign=return&utm_content=video-b&fbclid=f-1", analyticsSessionId: `s2-${stamp}`, eventKey: "start" } });
  expect(second.status()).toBe(200);
  const leadResponse = await request.post("/api/leads", { data: { visitorId, answers: { zipCode: "73301" } } });
  expect(leadResponse.status()).toBe(200);
  const lead = (await leadResponse.json()).lead;
  expect(lead).toMatchObject({ source: "google", medium: "cpc", campaign: "first", content: "ad-a", gclid: "g-1", lastSource: "facebook", lastMedium: "paid-social", lastCampaign: "return", lastContent: "video-b", lastFbclid: "f-1" });

  const forged = await request.post("/api/track", { data: { ...first, eventType: "customer_won", eventKey: `lead:${lead.id}:outcome:won` } });
  expect(forged.status()).toBe(400);
  expect(await prisma.funnelEvent.count({ where: { leadId: lead.id, eventType: "customer_won" } })).toBe(0);
});

test("reports are tenant-, demo-mode-, date-, and company-timezone scoped", async () => {
  const stamp = Date.now();
  const primary = await prisma.company.findFirstOrThrow({ where: { slug: "demo-pest-control" } });
  const other = await prisma.company.create({ data: { name: "Analytics Other", slug: `analytics-other-${stamp}`, timezone: "America/Chicago", serviceZipCodes: primary.serviceZipCodes, supportedPests: primary.supportedPests, businessHours: primary.businessHours, scoringRules: primary.scoringRules, isDemo: false } });
  const localDayInstant = new Date("2026-08-21T04:30:00.000Z"); // Aug 20 in America/Chicago
  await prisma.funnelEvent.createMany({ data: [
    { companyId: primary.id, visitorId: `demo-${stamp}`, eventType: "landing_page_view", eventKey: `demo:${stamp}`, isDemo: true, createdAt: localDayInstant, source: "google", medium: "cpc", campaign: `timezone-${stamp}` },
    { companyId: primary.id, visitorId: `wrong-mode-${stamp}`, eventType: "landing_page_view", eventKey: `wrong-mode:${stamp}`, isDemo: false, createdAt: localDayInstant },
    { companyId: other.id, visitorId: `other-${stamp}`, eventType: "landing_page_view", eventKey: `other:${stamp}`, isDemo: false, createdAt: localDayInstant },
  ] });
  const aug20 = await getDashboardMetrics(primary.id, { preset: "custom", start: "2026-08-20", end: "2026-08-20", now: localDayInstant });
  const aug21 = await getDashboardMetrics(primary.id, { preset: "custom", start: "2026-08-21", end: "2026-08-21", now: localDayInstant });
  expect(aug20.marketingPerformance.find((row) => row.campaign === `timezone-${stamp}`)).toMatchObject({ source: "google", visitors: 1 });
  expect(aug21.marketingPerformance.some((row) => row.campaign === `timezone-${stamp}`)).toBe(false);
});

test("source reporting deduplicates stages and attributes real revenue without inventing spend", async () => {
  const stamp = Date.now(); const primary = await prisma.company.findFirstOrThrow({ where: { slug: "demo-pest-control" } });
  const lead = await prisma.lead.create({ data: { companyId: primary.id, isDemo: true, visitorId: `journey-${stamp}`, source: "google", medium: "cpc", campaign: `campaign-${stamp}`, content: "creative-a", classification: "sql", outcome: "won", contractValueCents: 50000 } });
  const base = { companyId: primary.id, visitorId: lead.visitorId!, leadId: lead.id, isDemo: true, source: "google", medium: "cpc", campaign: `campaign-${stamp}`, content: "creative-a" };
  await prisma.funnelEvent.createMany({ data: [
    { ...base, eventType: "lead_created", eventKey: `lead:${lead.id}:created` }, { ...base, eventType: "lead_qualified", eventKey: `lead:${lead.id}:qualified` },
    { ...base, eventType: "inspection_booked", eventKey: `lead:${lead.id}:booked` }, { ...base, eventType: "inspection_completed", eventKey: `lead:${lead.id}:completed` },
    { ...base, eventType: "customer_won", eventKey: `lead:${lead.id}:won` }, { ...base, eventType: "revenue_recorded", eventKey: `lead:${lead.id}:revenue`, metadata: JSON.stringify({ amountCents: 50000 }) },
  ] });
  const metrics = await getDashboardMetrics(primary.id, { preset: "today" });
  const row = metrics.marketingPerformance.find((item) => item.campaign === `campaign-${stamp}`)!;
  expect(row).toMatchObject({ leads: 1, qualified: 1, booked: 1, completed: 1, customers: 1, revenueCents: 50000, spendCents: null, costPerLeadCents: null, roas: null });
});

test("server event replay remains idempotent inside a PostgreSQL transaction", async () => {
  const primary = await prisma.company.findFirstOrThrow({ where: { slug: "demo-pest-control" } });
  const key = `transaction-replay-${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    const input = { companyId: primary.id, visitorId: key, eventType: "lead_created" as const, eventKey: key, isDemo: true };
    await recordFunnelEvent(input, tx);
    await recordFunnelEvent(input, tx);
  });
  expect(await prisma.funnelEvent.count({ where: { companyId: primary.id, eventKey: key } })).toBe(1);
});

test("correcting won to lost replaces the outcome and invalidates attributed revenue", async () => {
  const stamp = Date.now();
  const primary = await prisma.company.findFirstOrThrow({ where: { slug: "demo-pest-control" } });
  const lead = await prisma.lead.create({
    data: { companyId: primary.id, isDemo: true, visitorId: `outcome-${stamp}`, campaign: `outcome-${stamp}` },
  });
  const base = { companyId: primary.id, leadId: lead.id, visitorId: lead.visitorId!, isDemo: true, attribution: { campaign: lead.campaign } };
  await recordCustomerOutcomeEvent({ ...base, outcome: "won" });
  await recordRevenueEvent({ ...base, amountCents: 125000 });
  await recordCustomerOutcomeEvent({ ...base, outcome: "lost" });
  await clearRevenueEvent(primary.id, lead.id);

  expect(await prisma.funnelEvent.findMany({
    where: { companyId: primary.id, leadId: lead.id },
    select: { eventType: true, eventKey: true },
    orderBy: { eventKey: "asc" },
  })).toEqual([
    { eventType: "customer_lost", eventKey: `lead:${lead.id}:outcome` },
    { eventType: "revenue_removed", eventKey: `lead:${lead.id}:revenue` },
  ]);
  const metrics = await getDashboardMetrics(primary.id, { preset: "today" });
  const row = metrics.marketingPerformance.find((item) => item.campaign === `outcome-${stamp}`)!;
  expect(row).toMatchObject({ customers: 0, revenueCents: null });
});
