import type { FunnelEventType } from "./pipeline";

/**
 * Pure analytics/economics calculations. Every function returns `null` for
 * a metric it cannot honestly compute (no spend entered, zero denominator,
 * etc.) rather than fabricating a number — callers must render that as
 * "no data yet," never as zero or a guess.
 */

export function computeFunnelCounts(
  events: { eventType: string }[],
): Record<FunnelEventType, number> {
  const counts = {
    visit: 0,
    assessment_start: 0,
    contact_captured: 0,
    lead_created: 0,
    mql: 0,
    sql: 0,
    scheduler_viewed: 0,
    appointment_booked: 0,
    appointment_completed: 0,
    customer_won: 0,
    customer_lost: 0,
  } as Record<FunnelEventType, number>;

  for (const event of events) {
    if (event.eventType in counts) {
      counts[event.eventType as FunnelEventType] += 1;
    }
  }
  return counts;
}

export interface FunnelStageRate {
  from: FunnelEventType;
  to: FunnelEventType;
  rate: number | null; // 0-1, or null if `from` count is 0
  dropOff: number | null; // 1 - rate
}

const FUNNEL_ORDER: FunnelEventType[] = [
  "visit",
  "assessment_start",
  "contact_captured",
  "lead_created",
  "mql",
  "sql",
  "scheduler_viewed",
  "appointment_booked",
  "appointment_completed",
];

export function computeStageConversionRates(
  counts: Record<FunnelEventType, number>,
): FunnelStageRate[] {
  const rates: FunnelStageRate[] = [];
  for (let i = 0; i < FUNNEL_ORDER.length - 1; i++) {
    const from = FUNNEL_ORDER[i];
    const to = FUNNEL_ORDER[i + 1];
    const fromCount = counts[from];
    const rate = fromCount > 0 ? counts[to] / fromCount : null;
    rates.push({ from, to, rate, dropOff: rate === null ? null : 1 - rate });
  }
  return rates;
}

/**
 * Cost-per-X metrics. `spendCents === null` (no marketing spend entered
 * yet) or a zero count means the metric is unknown, not zero.
 */
export function computeCostMetrics(params: {
  spendCents: number | null;
  leadsCount: number;
  mqlCount: number;
  sqlCount: number;
  bookedCount: number;
  completedCount: number;
}) {
  const { spendCents, leadsCount, mqlCount, sqlCount, bookedCount, completedCount } =
    params;

  const per = (count: number) =>
    spendCents === null || count <= 0 ? null : spendCents / count;

  return {
    costPerLeadCents: per(leadsCount),
    costPerMqlCents: per(mqlCount),
    costPerSqlCents: per(sqlCount),
    costPerBookedInspectionCents: per(bookedCount),
    costPerCompletedInspectionCents: per(completedCount),
  };
}

/**
 * Customer acquisition cost = total spend / customers won. Revenue-based
 * metrics (ROAS) require actual contract-value data; both are null until
 * the required inputs exist.
 */
export function computeCac(spendCents: number | null, customersWon: number) {
  if (spendCents === null || customersWon <= 0) return null;
  return spendCents / customersWon;
}

export function computeReturnOnSpend(
  revenueCents: number | null,
  spendCents: number | null,
) {
  if (revenueCents === null || spendCents === null || spendCents <= 0) return null;
  return revenueCents / spendCents;
}

export function computeShowRate(
  completedCount: number,
  bookedCount: number,
): number | null {
  if (bookedCount <= 0) return null;
  return completedCount / bookedCount;
}

export function computeCloseRate(
  wonCount: number,
  completedCount: number,
): number | null {
  if (completedCount <= 0) return null;
  return wonCount / completedCount;
}
