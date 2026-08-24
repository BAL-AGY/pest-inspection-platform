import { computeCac, computeReturnOnSpend, computeRoi } from "@/lib/analytics";
import { CHANNELS, channelForSource, type ChannelDefinition } from "./channels";

// Groups the platform's existing, real campaignPerformance() rows (the
// same rows the Overview dashboard's "Marketing performance" table
// already renders) by channel — a re-bucketing of real data, never a new
// calculation and never fabricated. A channel with zero matching rows
// simply has zero leads/spend/revenue; a channel where every matching row
// has no logged spend reports spendCents: null ("cost tracking
// unavailable"), exactly like the existing per-row "Unavailable" behavior.

export interface MarketingPerformanceRow {
  source: string; medium: string; campaign: string; content: string;
  spendCents: number | null; visitors: number; leads: number; qualified: number;
  booked: number; completed: number; customers: number; revenueCents: number | null;
}

export interface ChannelPerformance {
  channel: ChannelDefinition;
  spendCents: number | null;
  visitors: number; leads: number; qualified: number; booked: number; completed: number; customers: number;
  revenueCents: number | null;
  cac: number | null;
  roas: number | null;
  roi: number | null;
}

export function computeChannelPerformance(rows: MarketingPerformanceRow[]): ChannelPerformance[] {
  const byChannel = new Map<string, MarketingPerformanceRow[]>();
  for (const row of rows) {
    const channel = channelForSource(row.source);
    const list = byChannel.get(channel.id) ?? [];
    list.push(row);
    byChannel.set(channel.id, list);
  }

  return CHANNELS.map((channel) => {
    const channelRows = byChannel.get(channel.id) ?? [];
    const spendKnown = channelRows.some((r) => r.spendCents !== null);
    const spendCents = spendKnown ? channelRows.reduce((sum, r) => sum + (r.spendCents ?? 0), 0) : null;
    const revenueKnown = channelRows.some((r) => r.revenueCents !== null);
    const revenueCents = revenueKnown ? channelRows.reduce((sum, r) => sum + (r.revenueCents ?? 0), 0) : null;
    const visitors = channelRows.reduce((sum, r) => sum + r.visitors, 0);
    const leads = channelRows.reduce((sum, r) => sum + r.leads, 0);
    const qualified = channelRows.reduce((sum, r) => sum + r.qualified, 0);
    const booked = channelRows.reduce((sum, r) => sum + r.booked, 0);
    const completed = channelRows.reduce((sum, r) => sum + r.completed, 0);
    const customers = channelRows.reduce((sum, r) => sum + r.customers, 0);
    return {
      channel, spendCents, visitors, leads, qualified, booked, completed, customers, revenueCents,
      cac: computeCac(spendCents, customers),
      roas: computeReturnOnSpend(revenueCents, spendCents),
      roi: computeRoi(revenueCents, spendCents),
    };
  }).filter((c) => c.leads > 0 || c.visitors > 0 || c.spendCents !== null);
}
