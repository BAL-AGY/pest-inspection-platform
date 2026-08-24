// Ad-platform adapter boundary. Purpose: define the shape a future Meta
// Marketing API / Google Ads API integration will normalize into, so the
// rest of the app (campaign attribution, MarketingSpend, the experiment
// tracker) can consume ad-platform data without caring which platform it
// came from. This file defines interfaces only — no network calls, no
// credentials required, and nothing here is invoked by any live code path
// yet. See docs/marketing-intelligence/README.md ("Ad platform adapters")
// for the integration plan.

export interface AdPlatformCampaign {
  externalCampaignId: string;
  name: string;
  status: string;
}

export interface AdPlatformAdSet {
  externalAdSetId: string;
  externalCampaignId: string;
  name: string;
  targetingDescription: string | null;
}

export interface AdPlatformCreative {
  externalAdId: string;
  externalAdSetId: string;
  name: string;
  creativeType: string | null;
}

// One row of performance data for a given ad/creative over a date range.
// Every numeric field is nullable — an adapter must never invent a number
// the platform API didn't actually return for that row, matching the same
// "never fabricate a metric" rule the case-study schema enforces.
export interface AdPlatformPerformanceRow {
  externalAdId: string;
  externalAdSetId: string;
  externalCampaignId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  spendCents: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null; // 0-1 fraction
  cpcCents: number | null;
  conversions: number | null;
}

// Maps one AdPlatformPerformanceRow onto the platform's existing attribution
// dimensions (source/medium/campaign/content — the same fields
// MarketingSpend and FunnelEvent already use), so imported ad data slots
// directly into campaignPerformance() with no separate reporting path.
export interface AttributionMapping {
  source: string; // e.g. "meta", "google"
  medium: string; // e.g. "paid_social", "cpc"
  campaign: string;
  content: string | null;
}

export interface AdPlatformAdapter {
  readonly platform: "meta" | "google_ads";
  // Whether this adapter has the credentials/config it needs to make real
  // API calls. The app must check this before calling any other method —
  // an unconfigured adapter must never be invoked, and its absence must
  // never break a build or deployment.
  isConfigured(): boolean;
  fetchCampaigns(params: { since: string; until: string }): Promise<AdPlatformCampaign[]>;
  fetchAdSets(campaignId: string): Promise<AdPlatformAdSet[]>;
  fetchCreatives(adSetId: string): Promise<AdPlatformCreative[]>;
  fetchPerformance(params: { since: string; until: string }): Promise<AdPlatformPerformanceRow[]>;
  mapToAttribution(row: AdPlatformPerformanceRow, campaign: AdPlatformCampaign): AttributionMapping;
}
