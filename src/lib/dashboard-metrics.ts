import { prisma } from "./prisma";
import {
  computeCac,
  computeAttributionBreakdown,
  computeCloseRate,
  computeConversionRate,
  computeCostMetrics,
  computeFunnelCounts,
  computeReturnOnSpend,
  computeRoi,
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
    qualifiedCount,
    completedInspections,
    customersWon,
    customersLost,
    funnelEvents,
    marketingSpend,
    attributedLeads,
    bookedCount,
    noShowInspections,
    completedLeadCount,
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
    prisma.lead.count({ where: { companyId, classification: { in: ["mql", "sql"] } } }),
    prisma.appointment.count({ where: { companyId, status: "completed" } }),
    prisma.lead.count({ where: { companyId, outcome: "won" } }),
    prisma.lead.count({ where: { companyId, outcome: "lost" } }),
    prisma.funnelEvent.findMany({ where: { companyId }, select: { eventType: true } }),
    prisma.marketingSpend.aggregate({ where: { companyId }, _sum: { amountCents: true } }),
    prisma.lead.findMany({
      where: { companyId },
      select: {
        source: true,
        campaign: true,
        classification: true,
        outcome: true,
        contractValueCents: true,
        appointments: { select: { id: true }, take: 1 },
      },
    }),
    prisma.lead.count({
      where: {
        companyId,
        classification: { in: ["mql", "sql"] },
        appointments: { some: {} },
      },
    }),
    prisma.appointment.count({ where: { companyId, status: "no_show" } }),
    prisma.lead.count({ where: { companyId, appointments: { some: { status: "completed" } } } }),
  ]);

  const funnelCounts = computeFunnelCounts(funnelEvents);
  const stageRates = computeStageConversionRates(funnelCounts);

  const spendCents = marketingSpend._sum.amountCents ?? null;
  const costMetrics = computeCostMetrics({
    spendCents,
    leadsCount: newLeads,
    qualifiedCount,
    mqlCount,
    sqlCount,
    bookedCount,
    completedCount: completedInspections,
  });
  const cac = computeCac(spendCents, customersWon);
  const wonLeads = attributedLeads.filter((lead) => lead.outcome === "won");
  const revenueCents = wonLeads.reduce((sum, lead) => sum + (lead.contractValueCents ?? 0), 0);
  const hasRevenue = wonLeads.length > 0;
  const attributionBreakdown = computeAttributionBreakdown(
    attributedLeads.map((lead) => ({ ...lead, hasAppointment: lead.appointments.length > 0 })),
  );
  const roas = computeReturnOnSpend(hasRevenue ? revenueCents : null, spendCents);
  const roi = computeRoi(hasRevenue ? revenueCents : null, spendCents);
  // Show rate is based only on inspections with an observed attendance
  // outcome. Future bookings and cancellations are not no-shows.
  const showRate = computeShowRate(completedInspections, completedInspections + noShowInspections);
  const closeRate = computeCloseRate(customersWon, completedLeadCount);
  const leadToQualifiedRate = computeConversionRate(qualifiedCount, newLeads);
  const qualifiedToBookedRate = computeConversionRate(bookedCount, qualifiedCount);

  return {
    inspectionsToday,
    inspectionsThisWeek,
    newLeads,
    mqlCount,
    sqlCount,
    qualifiedCount,
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
    roi,
    showRate,
    closeRate,
    leadToQualifiedRate,
    qualifiedToBookedRate,
    attributionBreakdown,
  };
}

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;
