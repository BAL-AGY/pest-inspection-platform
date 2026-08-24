import type { AdPlatformAdapter, AdPlatformAdSet, AdPlatformCampaign, AdPlatformCreative, AdPlatformPerformanceRow, AttributionMapping } from "./types";

// Google Ads API adapter — not yet implemented (same status as ./meta.ts).
// To implement for real: authenticate via GOOGLE_ADS_DEVELOPER_TOKEN +
// OAuth refresh token, query campaigns/ad groups/ads/metrics via
// Google Ads Query Language (GAQL), and map each row onto ./types.ts.
export class GoogleAdsAdapter implements AdPlatformAdapter {
  readonly platform = "google_ads" as const;

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN,
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "GoogleAdsAdapter is not configured — set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, and GOOGLE_ADS_REFRESH_TOKEN before calling it.",
      );
    }
  }

  async fetchCampaigns(_params: { since: string; until: string }): Promise<AdPlatformCampaign[]> {
    this.assertConfigured();
    throw new Error("GoogleAdsAdapter.fetchCampaigns is not implemented yet.");
  }

  async fetchAdSets(_campaignId: string): Promise<AdPlatformAdSet[]> {
    this.assertConfigured();
    throw new Error("GoogleAdsAdapter.fetchAdSets is not implemented yet.");
  }

  async fetchCreatives(_adSetId: string): Promise<AdPlatformCreative[]> {
    this.assertConfigured();
    throw new Error("GoogleAdsAdapter.fetchCreatives is not implemented yet.");
  }

  async fetchPerformance(_params: { since: string; until: string }): Promise<AdPlatformPerformanceRow[]> {
    this.assertConfigured();
    throw new Error("GoogleAdsAdapter.fetchPerformance is not implemented yet.");
  }

  mapToAttribution(_row: AdPlatformPerformanceRow, campaign: AdPlatformCampaign): AttributionMapping {
    return { source: "google", medium: "cpc", campaign: campaign.name, content: null };
  }
}
