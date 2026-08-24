import type { AdPlatformAdapter, AdPlatformAdSet, AdPlatformCampaign, AdPlatformCreative, AdPlatformPerformanceRow, AttributionMapping } from "./types";

// Meta Marketing API adapter — not yet implemented. Present so the
// integration boundary (AdPlatformAdapter) is proven out with a real
// candidate implementation shape before credentials exist. `isConfigured()`
// checks for the expected env vars but nothing in the app calls this adapter
// yet, so their absence never affects build or deployment.
//
// To implement for real: exchange META_ACCESS_TOKEN for campaign/ad-set/ad
// data via the Marketing API's /act_{ad_account_id}/campaigns,
// /adsets, /ads, and /insights endpoints, mapping each response row onto
// the interfaces in ./types.ts.
export class MetaAdapter implements AdPlatformAdapter {
  readonly platform = "meta" as const;

  isConfigured(): boolean {
    return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error("MetaAdapter is not configured — set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID before calling it.");
    }
  }

  async fetchCampaigns(_params: { since: string; until: string }): Promise<AdPlatformCampaign[]> {
    this.assertConfigured();
    throw new Error("MetaAdapter.fetchCampaigns is not implemented yet.");
  }

  async fetchAdSets(_campaignId: string): Promise<AdPlatformAdSet[]> {
    this.assertConfigured();
    throw new Error("MetaAdapter.fetchAdSets is not implemented yet.");
  }

  async fetchCreatives(_adSetId: string): Promise<AdPlatformCreative[]> {
    this.assertConfigured();
    throw new Error("MetaAdapter.fetchCreatives is not implemented yet.");
  }

  async fetchPerformance(_params: { since: string; until: string }): Promise<AdPlatformPerformanceRow[]> {
    this.assertConfigured();
    throw new Error("MetaAdapter.fetchPerformance is not implemented yet.");
  }

  mapToAttribution(_row: AdPlatformPerformanceRow, campaign: AdPlatformCampaign): AttributionMapping {
    return { source: "meta", medium: "paid_social", campaign: campaign.name, content: null };
  }
}
