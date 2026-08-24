import { prisma } from "@/lib/prisma";
import { campaignPerformance } from "@/lib/dashboard-metrics";
import { computeCac, computeReturnOnSpend, computeRoi } from "@/lib/analytics";

// Live metrics for a CampaignExperiment are NEVER stored — they're computed
// on every read by reusing campaignPerformance(), the exact same function
// that powers the existing "Marketing performance" table on the Overview
// dashboard. This file adds zero new event-counting logic; it only (a)
// fetches the same FunnelEvent/MarketingSpend rows that function already
// consumes and (b) sums the subset of its output rows that belong to this
// experiment's UTM identifiers.

export interface ExperimentLiveMetrics {
  visitors: number;
  leads: number;
  qualified: number;
  booked: number;
  completed: number;
  customers: number;
  spendCents: number | null;
  revenueCents: number | null;
  costPerLeadCents: number | null;
  costPerQualifiedLeadCents: number | null;
  costPerBookedInspectionCents: number | null;
  cac: number | null;
  roas: number | null;
  roi: number | null;
  bookingRate: number | null; // booked / qualified
  closeRate: number | null; // customers / completed
}

interface ExperimentUtm {
  utmSource: string;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export async function getExperimentLiveMetrics(
  companyId: string,
  experiment: ExperimentUtm,
  options: { isDemo: boolean; since?: Date | null; until?: Date | null },
): Promise<ExperimentLiveMetrics> {
  const mode = { companyId, isDemo: options.isDemo };
  const createdAt = {
    ...(options.since ? { gte: options.since } : {}),
    ...(options.until ? { lt: options.until } : {}),
  };
  const [events, spends] = await Promise.all([
    prisma.funnelEvent.findMany({
      where: { ...mode, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      select: { eventType: true, visitorId: true, leadId: true, appointmentId: true, funnelStep: true, source: true, medium: true, campaign: true, content: true, metadata: true },
    }),
    prisma.marketingSpend.findMany({
      where: { ...mode, source: experiment.utmSource, ...(experiment.utmMedium ? { medium: experiment.utmMedium } : {}), ...(experiment.utmCampaign ? { campaign: experiment.utmCampaign } : {}) },
      select: { source: true, medium: true, campaign: true, content: true, amountCents: true },
    }),
  ]);

  const rows = campaignPerformance(events, spends).filter(
    (row) =>
      row.source === experiment.utmSource &&
      (experiment.utmMedium === null || row.medium === experiment.utmMedium) &&
      (experiment.utmCampaign === null || row.campaign === experiment.utmCampaign),
  );

  const visitors = rows.reduce((sum, r) => sum + r.visitors, 0);
  const leads = rows.reduce((sum, r) => sum + r.leads, 0);
  const qualified = rows.reduce((sum, r) => sum + r.qualified, 0);
  const booked = rows.reduce((sum, r) => sum + r.booked, 0);
  const completed = rows.reduce((sum, r) => sum + r.completed, 0);
  const customers = rows.reduce((sum, r) => sum + r.customers, 0);
  const spendCents = rows.some((r) => r.spendCents !== null) ? rows.reduce((sum, r) => sum + (r.spendCents ?? 0), 0) : null;
  const revenueCents = rows.some((r) => r.revenueCents !== null) ? rows.reduce((sum, r) => sum + (r.revenueCents ?? 0), 0) : null;

  const per = (count: number) => (spendCents === null || count === 0 ? null : spendCents / count);

  return {
    visitors, leads, qualified, booked, completed, customers, spendCents, revenueCents,
    costPerLeadCents: per(leads),
    costPerQualifiedLeadCents: per(qualified),
    costPerBookedInspectionCents: per(booked),
    cac: computeCac(spendCents, customers),
    roas: computeReturnOnSpend(revenueCents, spendCents),
    roi: computeRoi(revenueCents, spendCents),
    bookingRate: qualified > 0 ? booked / qualified : null,
    closeRate: completed > 0 ? customers / completed : null,
  };
}

export async function listExperimentsWithMetrics(companyId: string, isDemo: boolean) {
  const experiments = await prisma.campaignExperiment.findMany({
    where: { companyId, isDemo },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    experiments.map(async (experiment) => ({
      experiment,
      metrics: await getExperimentLiveMetrics(companyId, experiment, { isDemo, since: experiment.startDate, until: experiment.endDate }),
    })),
  );
}
