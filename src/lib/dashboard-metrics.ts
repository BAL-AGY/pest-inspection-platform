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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export async function getDashboardMetrics(companyId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

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
