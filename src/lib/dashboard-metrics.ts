import { prisma } from "./prisma";
import { computeCac, computeCloseRate, computeCostMetrics, computeFunnelCounts, computeFunnelReport, computeQuestionDropOff, computeReturnOnSpend, computeRoi, computeShowRate, type AnalyticsEvent } from "./analytics";
import { resolveAnalyticsRange } from "./analytics-range";
import { parseCompanyTimeZone } from "./company";
import { QUALIFICATION_QUESTIONS } from "./qualification";
import { companyDayRange, companyWeekRange } from "./timezone";
import { parsePestCategories, pestCategoryForConcern } from "./service-catalog";

export function dashboardOperationalRanges(now: Date, timeZone: string) {
  const today = companyDayRange(now, timeZone); const week = companyWeekRange(now, timeZone);
  return { todayStart: today.start, tomorrowStart: today.end, weekStart: week.start, weekEnd: week.end };
}

type CategorizedEvent = AnalyticsEvent & {
  lead: { pestCategory: string | null; pestConcern: string | null; actualPestCategory: string | null } | null;
};

function pestCategoryPerformance(events: CategorizedEvent[], categories: ReturnType<typeof parsePestCategories>) {
  const rows = new Map(categories.map((category) => [category.id, {
    category: category.id, label: category.label, leads: new Set<string>(), qualified: new Set<string>(),
    booked: new Set<string>(), completed: new Set<string>(), customers: new Set<string>(), revenueCents: 0,
  }]));
  for (const event of events) {
    if (!event.lead || !event.leadId) continue;
    const acquisitionCategoryId = event.lead.pestCategory
      ?? pestCategoryForConcern(categories, event.lead.pestConcern)?.id;
    const usesInspectedCategory = ["inspection_completed", "customer_won", "customer_lost", "revenue_recorded", "revenue_removed"]
      .includes(event.eventType);
    const categoryId = usesInspectedCategory
      ? event.lead.actualPestCategory ?? acquisitionCategoryId
      : acquisitionCategoryId;
    if (!categoryId) continue;
    const row = rows.get(categoryId);
    if (!row) continue;
    if (event.eventType === "lead_created") row.leads.add(event.leadId);
    if (event.eventType === "lead_qualified") row.qualified.add(event.leadId);
    if (event.eventType === "inspection_booked") row.booked.add(event.leadId);
    if (event.eventType === "inspection_completed") row.completed.add(event.leadId);
    if (event.eventType === "customer_won") row.customers.add(event.leadId);
    if (event.eventType === "revenue_recorded" && event.metadata) {
      try {
        const amount = JSON.parse(event.metadata).amountCents;
        if (Number.isInteger(amount) && amount >= 0) row.revenueCents += amount;
      } catch { /* malformed legacy metadata contributes no revenue */ }
    }
  }
  return [...rows.values()].map((row) => ({
    category: row.category,
    label: row.label,
    leads: row.leads.size,
    qualified: row.qualified.size,
    booked: row.booked.size,
    completed: row.completed.size,
    customers: row.customers.size,
    closeRate: row.completed.size ? row.customers.size / row.completed.size : null,
    revenueCents: row.revenueCents,
    revenuePerCompletedInspectionCents: row.completed.size ? row.revenueCents / row.completed.size : null,
  }));
}

type Spend = { source: string; medium: string | null; campaign: string | null; content: string | null; amountCents: number };
function campaignPerformance(events: AnalyticsEvent[], spends: Spend[]) {
  const map = new Map<string, { source: string; medium: string; campaign: string; content: string; visitors: Set<string>; leads: Set<string>; qualified: Set<string>; booked: Set<string>; completed: Set<string>; customers: Set<string>; revenueCents: number; revenueKnown: boolean; spendCents: number | null }>();
  const dimensions = (value: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null }) => [value.source ?? "direct", value.medium ?? "Unspecified", value.campaign ?? "Unspecified", value.content ?? "Unspecified"];
  const get = (dims: string[]) => {
    const key = JSON.stringify(dims); let row = map.get(key);
    if (!row) { row = { source: dims[0], medium: dims[1], campaign: dims[2], content: dims[3], visitors: new Set(), leads: new Set(), qualified: new Set(), booked: new Set(), completed: new Set(), customers: new Set(), revenueCents: 0, revenueKnown: false, spendCents: null }; map.set(key, row); }
    return row;
  };
  for (const event of events) {
    const row = get(dimensions(event)); const leadKey = event.leadId ?? event.visitorId;
    if (event.eventType === "landing_page_view") row.visitors.add(event.visitorId);
    if (event.eventType === "lead_created") row.leads.add(leadKey);
    if (event.eventType === "lead_qualified") row.qualified.add(leadKey);
    if (event.eventType === "inspection_booked") row.booked.add(leadKey);
    if (event.eventType === "inspection_completed") row.completed.add(leadKey);
    if (event.eventType === "customer_won") row.customers.add(leadKey);
    if (event.eventType === "revenue_recorded" && event.metadata) {
      try { const amount = JSON.parse(event.metadata).amountCents; if (Number.isInteger(amount) && amount >= 0) { row.revenueCents += amount; row.revenueKnown = true; } } catch { /* malformed legacy metadata is unavailable */ }
    }
  }
  for (const spend of spends) { const row = get(dimensions(spend)); row.spendCents = (row.spendCents ?? 0) + spend.amountCents; }
  return [...map.values()].map((row) => {
    const leads = row.leads.size, qualified = row.qualified.size, booked = row.booked.size, customers = row.customers.size;
    const per = (count: number) => row.spendCents === null || count === 0 ? null : row.spendCents / count;
    return { source: row.source, medium: row.medium, campaign: row.campaign, content: row.content, spendCents: row.spendCents, visitors: row.visitors.size, leads, qualified, booked, completed: row.completed.size, customers, revenueCents: row.revenueKnown ? row.revenueCents : null, costPerLeadCents: per(leads), costPerQualifiedLeadCents: per(qualified), costPerBookedInspectionCents: per(booked), cac: per(customers), roas: computeReturnOnSpend(row.revenueKnown ? row.revenueCents : null, row.spendCents), roi: computeRoi(row.revenueKnown ? row.revenueCents : null, row.spendCents) };
  }).sort((a, b) => b.customers - a.customers || b.booked - a.booked || b.leads - a.leads);
}

export async function getDashboardMetrics(companyId: string, options: { preset?: string; start?: string; end?: string; now?: Date } = {}) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true, isDemo: true, pestCategoryConfig: true } });
  if (!company) throw new Error("Company not found.");
  const now = options.now ?? new Date(); const timeZone = parseCompanyTimeZone(company);
  const range = resolveAnalyticsRange(options, timeZone, now);
  const operational = dashboardOperationalRanges(now, timeZone);
  const mode = { companyId, isDemo: company.isDemo };
  const [inspectionsToday, inspectionsThisWeek, events, spends, sqlCount, mqlCount, noShows] = await Promise.all([
    prisma.appointment.count({ where: { ...mode, status: { in: ["booked", "rescheduled"] }, scheduledStart: { gte: operational.todayStart, lt: operational.tomorrowStart } } }),
    prisma.appointment.count({ where: { ...mode, status: { in: ["booked", "rescheduled"] }, scheduledStart: { gte: operational.weekStart, lt: operational.weekEnd } } }),
    prisma.funnelEvent.findMany({ where: { ...mode, createdAt: { gte: range.start, lt: range.end } }, select: { eventType: true, visitorId: true, leadId: true, appointmentId: true, funnelStep: true, source: true, medium: true, campaign: true, content: true, metadata: true, lead: { select: { pestCategory: true, pestConcern: true, actualPestCategory: true } } } }),
    prisma.marketingSpend.findMany({ where: { ...mode, periodStart: { lt: range.end }, periodEnd: { gte: range.start } }, select: { source: true, medium: true, campaign: true, content: true, amountCents: true } }),
    prisma.lead.count({ where: { ...mode, classification: "sql", createdAt: { gte: range.start, lt: range.end } } }),
    prisma.lead.count({ where: { ...mode, classification: "mql", createdAt: { gte: range.start, lt: range.end } } }),
    prisma.appointment.count({ where: { ...mode, status: "no_show", updatedAt: { gte: range.start, lt: range.end } } }),
  ]);
  const funnelCounts = computeFunnelCounts(events); const funnelStages = computeFunnelReport(events);
  const stage = (key: string) => funnelStages.find((item) => item.key === key)?.count ?? 0;
  const visitors = stage("landing_page_view"), funnelStarts = stage("funnel_started"), newLeads = stage("lead_created"), qualifiedCount = stage("lead_qualified"), bookedCount = stage("inspection_booked"), completedInspections = stage("inspection_completed"), customersWon = stage("customer_won");
  const customersLost = new Set(events.filter((e) => e.eventType === "customer_lost").map((e) => e.leadId ?? e.visitorId)).size;
  const revenueEvents = events.filter((e) => e.eventType === "revenue_recorded"); let revenueCents = 0; let hasRevenue = false;
  for (const event of revenueEvents) { try { const amount = JSON.parse(event.metadata ?? "null")?.amountCents; if (Number.isInteger(amount) && amount >= 0) { revenueCents += amount; hasRevenue = true; } } catch { /* unavailable */ } }
  const marketingSpendCents = spends.length ? spends.reduce((sum, item) => sum + item.amountCents, 0) : null;
  const costMetrics = computeCostMetrics({ spendCents: marketingSpendCents, leadsCount: newLeads, qualifiedCount, mqlCount, sqlCount, bookedCount, completedCount: completedInspections });
  return {
    range, isDemo: company.isDemo, timeZone, inspectionsToday, inspectionsThisWeek, visitors, funnelStarts, newLeads, mqlCount, sqlCount, qualifiedCount, bookedCount, completedInspections, customersWon, customersLost,
    funnelCounts, funnelStages, questionDropOff: computeQuestionDropOff(events, [...QUALIFICATION_QUESTIONS.map((q) => q.id), "contact"]), marketingSpendCents, costMetrics,
    cac: computeCac(marketingSpendCents, customersWon), revenueCents: hasRevenue ? revenueCents : null,
    roas: computeReturnOnSpend(hasRevenue ? revenueCents : null, marketingSpendCents), roi: computeRoi(hasRevenue ? revenueCents : null, marketingSpendCents),
    showRate: computeShowRate(completedInspections, completedInspections + noShows), closeRate: computeCloseRate(customersWon, completedInspections),
    visitorToStartRate: visitors ? funnelStarts / visitors : null, leadToQualifiedRate: newLeads ? qualifiedCount / newLeads : null, qualifiedToBookedRate: qualifiedCount ? bookedCount / qualifiedCount : null,
    marketingPerformance: campaignPerformance(events, spends),
    pestCategoryPerformance: pestCategoryPerformance(events, parsePestCategories(company)),
  };
}
export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;
