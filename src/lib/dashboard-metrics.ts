import { prisma } from "./prisma";
import {
  computeCac,
  computeCloseRate,
  computeCostMetrics,
  computeFunnelCounts,
  computeReturnOnSpend,
  computeShowRate,
  computeStageConversionRates,
} from "./analytics";
import { parseCompanyTimeZone } from "./company";
import { companyDayRange, companyWeekRange } from "./timezone";

export function dashboardOperationalRanges(now: Date, timeZone: string) {
  const today = companyDayRange(now, timeZone);
  const week = companyWeekRange(now, timeZone);
  return { todayStart: today.start, tomorrowStart: today.end, weekStart: week.start, weekEnd: week.end };
}

export async function getDashboardMetrics(companyId: string, now = new Date()) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  if (!company) throw new Error("Company not found.");
  const timeZone = parseCompanyTimeZone(company);
  const { todayStart, tomorrowStart, weekStart, weekEnd } = dashboardOperationalRanges(now, timeZone);

  const [
    inspectionsToday,
    inspectionsThisWeek,
    newLeads,
    mqlCount,
    sqlCount,
    completedInspections,
    customersWon,
    customersLost,
    funnelEvents,
    marketingSpend,
    leadsForRevenue,
    bookedCount,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        companyId,
        status: { in: ["booked", "rescheduled"] },
        scheduledStart: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.appointment.count({
      where: {
        companyId,
        status: { in: ["booked", "rescheduled"] },
        scheduledStart: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.lead.count({ where: { companyId } }),
    prisma.lead.count({ where: { companyId, classification: "mql" } }),
    prisma.lead.count({ where: { companyId, classification: "sql" } }),
    prisma.appointment.count({ where: { companyId, status: "completed" } }),
    prisma.lead.count({ where: { companyId, outcome: "won" } }),
    prisma.lead.count({ where: { companyId, outcome: "lost" } }),
    prisma.funnelEvent.findMany({ where: { companyId }, select: { eventType: true } }),
    prisma.marketingSpend.aggregate({ where: { companyId }, _sum: { amountCents: true } }),
    prisma.lead.findMany({
      where: { companyId, outcome: "won" },
      select: { contractValueCents: true },
    }),
    prisma.appointment.count({
      where: { companyId, status: { in: ["booked", "rescheduled", "completed", "no_show"] } },
    }),
  ]);

  const funnelCounts = computeFunnelCounts(funnelEvents);
  const stageRates = computeStageConversionRates(funnelCounts);

  const spendCents = marketingSpend._sum.amountCents ?? null;
  const costMetrics = computeCostMetrics({
    spendCents,
    leadsCount: newLeads,
    mqlCount,
    sqlCount,
    bookedCount,
    completedCount: completedInspections,
  });
  const cac = computeCac(spendCents, customersWon);
  const revenueCents = leadsForRevenue.reduce((sum, l) => sum + (l.contractValueCents ?? 0), 0);
  const hasRevenue = leadsForRevenue.length > 0;
  const roas = computeReturnOnSpend(hasRevenue ? revenueCents : null, spendCents);
  const showRate = computeShowRate(completedInspections, bookedCount);
  const closeRate = computeCloseRate(customersWon, completedInspections);

  return {
    inspectionsToday,
    inspectionsThisWeek,
    newLeads,
    mqlCount,
    sqlCount,
    completedInspections,
    customersWon,
    customersLost,
    bookedCount,
    funnelCounts,
    stageRates,
    marketingSpendCents: spendCents,
    costMetrics,
    cac,
    revenueCents: hasRevenue ? revenueCents : null,
    roas,
    showRate,
    closeRate,
  };
}

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;
