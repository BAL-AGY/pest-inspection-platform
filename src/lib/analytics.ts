import { FUNNEL_EVENT_TYPES, type FunnelEventType } from "./pipeline";

/** Analytics calculations never turn unavailable spend/revenue into zero. */
export function computeFunnelCounts(events: { eventType: string }[]): Record<FunnelEventType, number> {
  const counts = Object.fromEntries(FUNNEL_EVENT_TYPES.map((type) => [type, 0])) as Record<FunnelEventType, number>;
  for (const event of events) if (event.eventType in counts) counts[event.eventType as FunnelEventType] += 1;
  return counts;
}

export interface AnalyticsEvent {
  eventType: string; visitorId: string; leadId?: string | null; appointmentId?: string | null;
  funnelStep?: string | null; source?: string | null; medium?: string | null;
  campaign?: string | null; content?: string | null; metadata?: string | null;
}

export const PRIMARY_FUNNEL = [
  ["landing_page_view", "Visitors"], ["funnel_started", "Funnel starts"],
  ["lead_created", "Leads"], ["lead_qualified", "Qualified leads"],
  ["inspection_booked", "Booked inspections"], ["inspection_completed", "Completed inspections"],
  ["customer_won", "Customers won"],
] as const;

function entityKey(event: AnalyticsEvent) {
  return ["landing_page_view", "inspection_cta_clicked", "funnel_started"].includes(event.eventType)
    ? `visitor:${event.visitorId}` : event.leadId ? `lead:${event.leadId}` : `visitor:${event.visitorId}`;
}

export function computeFunnelReport(events: AnalyticsEvent[]) {
  return PRIMARY_FUNNEL.map(([key, label], index) => {
    const count = new Set(events.filter((event) => event.eventType === key).map(entityKey)).size;
    if (index === 0) return { key, label, count, conversionFromPrevious: null, abandoned: null };
    const priorJourneys = new Set(events.filter((event) => event.eventType === PRIMARY_FUNNEL[index - 1][0]).map((event) => event.visitorId));
    const currentJourneys = new Set(events.filter((event) => event.eventType === key).map((event) => event.visitorId));
    const progressed = [...priorJourneys].filter((journey) => currentJourneys.has(journey)).length;
    return { key, label, count, conversionFromPrevious: priorJourneys.size ? progressed / priorJourneys.size : null, abandoned: priorJourneys.size - progressed };
  });
}

export function computeQuestionDropOff(events: AnalyticsEvent[], questionOrder: string[]) {
  const starts = new Set(events.filter((event) => event.eventType === "funnel_started").map(entityKey)).size;
  const hasExplicitRouting = events.some((event) => {
    try { return typeof JSON.parse(event.metadata ?? "null")?.nextQuestionId === "string"; } catch { return false; }
  });
  return questionOrder.map((step, index) => {
    const completed = new Set(events.filter((event) => step === "contact"
      ? event.eventType === "contact_information_submitted"
      : event.eventType === "qualification_question_answered" && event.funnelStep === step).map(entityKey)).size;
    const explicitReach = new Set(events.filter((event) => {
      try { return JSON.parse(event.metadata ?? "null")?.nextQuestionId === step; } catch { return false; }
    }).map(entityKey)).size;
    const legacyReach = new Set(events.filter((event) => event.eventType === "qualification_question_answered" && event.funnelStep === questionOrder[index - 1]).map(entityKey)).size;
    const reached = index === 0 ? starts : hasExplicitRouting ? explicitReach : legacyReach;
    return { key: step, reached, completed, abandoned: Math.max(reached - completed, 0), conversion: reached > 0 ? completed / reached : null };
  });
}

export interface FunnelStageRate { from: FunnelEventType; to: FunnelEventType; rate: number | null; dropOff: number | null }
export function computeStageConversionRates(counts: Record<FunnelEventType, number>): FunnelStageRate[] {
  return PRIMARY_FUNNEL.slice(0, -1).map(([from], index) => {
    const to = PRIMARY_FUNNEL[index + 1][0];
    const rate = counts[from] > 0 ? counts[to] / counts[from] : null;
    return { from, to, rate, dropOff: rate === null ? null : 1 - rate };
  });
}

export function computeCostMetrics(params: { spendCents: number | null; leadsCount: number; qualifiedCount: number; mqlCount: number; sqlCount: number; bookedCount: number; completedCount: number }) {
  const per = (count: number) => params.spendCents === null || count <= 0 ? null : params.spendCents / count;
  return { costPerLeadCents: per(params.leadsCount), costPerQualifiedLeadCents: per(params.qualifiedCount), costPerMqlCents: per(params.mqlCount), costPerSqlCents: per(params.sqlCount), costPerBookedInspectionCents: per(params.bookedCount), costPerCompletedInspectionCents: per(params.completedCount) };
}
export function computeCac(spendCents: number | null, customersWon: number) { return spendCents === null || customersWon <= 0 ? null : spendCents / customersWon; }
export function computeReturnOnSpend(revenueCents: number | null, spendCents: number | null) { return revenueCents === null || spendCents === null || spendCents <= 0 ? null : revenueCents / spendCents; }
export function computeRoi(revenueCents: number | null, spendCents: number | null) { return revenueCents === null || spendCents === null || spendCents <= 0 ? null : (revenueCents - spendCents) / spendCents; }
export function computeConversionRate(numerator: number, denominator: number) { return denominator <= 0 ? null : numerator / denominator; }
export function computeShowRate(completedCount: number, observedCount: number) { return observedCount <= 0 ? null : completedCount / observedCount; }
export function computeCloseRate(wonCount: number, completedCount: number) { return completedCount <= 0 ? null : wonCount / completedCount; }

export interface AttributionLead { source: string | null; medium?: string | null; campaign: string | null; content?: string | null; classification: string; outcome: string | null; contractValueCents: number | null; hasAppointment: boolean }
export function computeAttributionBreakdown(leads: AttributionLead[]) {
  const groups = new Map<string, { source: string; medium: string; campaign: string; content: string; leads: number; qualified: number; booked: number; won: number; contractValueCents: number }>();
  for (const lead of leads) {
    const dimensions = [lead.source ?? "direct", lead.medium ?? "Unspecified", lead.campaign ?? "Unspecified", lead.content ?? "Unspecified"];
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? { source: dimensions[0], medium: dimensions[1], campaign: dimensions[2], content: dimensions[3], leads: 0, qualified: 0, booked: 0, won: 0, contractValueCents: 0 };
    group.leads += 1;
    if (["mql", "sql"].includes(lead.classification)) group.qualified += 1;
    if (lead.hasAppointment) group.booked += 1;
    if (lead.outcome === "won") { group.won += 1; group.contractValueCents += lead.contractValueCents ?? 0; }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.booked - a.booked || b.leads - a.leads);
}
