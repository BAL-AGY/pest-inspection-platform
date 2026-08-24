import { MetaAdapter } from "@/lib/ad-platforms/meta";
import { GoogleAdsAdapter } from "@/lib/ad-platforms/google-ads";

// The channel registry — every customer-acquisition source the Integrations
// Hub can display. Extending this list (a new channel) never requires
// touching the aggregation/UI code below it; both iterate this array.
//
// "hasAdapter": true means a real AdPlatformAdapter exists
// (src/lib/ad-platforms/) whose isConfigured() determines real connection
// status. false means no adapter exists yet for this channel — it is
// ALWAYS reported "not_connected" with no live status check, since there is
// nothing to check yet (see docs/marketing-intelligence/README.md's "Ad
// platform adapters" section for the pattern a future adapter would follow).
export type ChannelCategory = "media_spend" | "outreach_cost" | "platform_cost" | "organic";

export interface ChannelDefinition {
  id: string;
  label: string;
  category: ChannelCategory;
  description: string;
  imports: string[]; // what a real connection would import — shown in the "what this connects" explainer
  // Attribution `source` values (as already stored on Lead/FunnelEvent/
  // MarketingSpend, from UTM parsing — see src/lib/attribution.ts) that
  // belong to this channel, for aggregating real marketingPerformance rows.
  // Never used to reclassify or invent data — only to bucket existing rows.
  sourceMatchers: string[];
  hasAdapter: boolean;
}

export const CHANNELS: ChannelDefinition[] = [
  {
    id: "meta",
    label: "Meta Ads",
    category: "media_spend",
    description: "Facebook and Instagram campaign spend, leads, and revenue.",
    imports: ["Campaign spend", "Impressions", "Clicks", "Campaigns", "Ad sets", "Ads"],
    sourceMatchers: ["facebook", "meta", "instagram"],
    hasAdapter: true,
  },
  {
    id: "google_ads",
    label: "Google Ads",
    category: "media_spend",
    description: "Search and Display campaign spend, clicks, and conversions.",
    imports: ["Campaign spend", "Impressions", "Clicks", "Campaigns", "Ad groups", "Ads"],
    sourceMatchers: ["google"],
    hasAdapter: true,
  },
  {
    id: "google_analytics",
    label: "Google Analytics",
    category: "platform_cost",
    description: "Cross-channel traffic and on-site behavior to complement first-party attribution.",
    imports: ["Sessions", "Traffic sources", "On-site events"],
    sourceMatchers: [],
    hasAdapter: false,
  },
  {
    id: "cold_email",
    label: "Cold Email",
    category: "outreach_cost",
    description: "Outbound cold-email sequences — a first-class acquisition source, not just a proxy metric.",
    imports: ["Emails sent", "Delivered", "Opened", "Replies", "Positive replies"],
    sourceMatchers: ["cold_email", "coldemail"],
    hasAdapter: false,
  },
  {
    id: "email_marketing",
    label: "Email Marketing",
    category: "outreach_cost",
    description: "Lifecycle and follow-up email campaigns to existing leads.",
    imports: ["Sends", "Opens", "Clicks", "Conversions"],
    sourceMatchers: ["email"],
    hasAdapter: false,
  },
  {
    id: "sms",
    label: "SMS",
    category: "outreach_cost",
    description: "Text-message outreach and reminders.",
    imports: ["Sends", "Delivery status", "Replies"],
    sourceMatchers: ["sms"],
    hasAdapter: false,
  },
  {
    id: "google_business_profile",
    label: "Google Business Profile",
    category: "organic",
    description: "Local search visibility, calls, and direction requests from your Google listing.",
    imports: ["Profile views", "Calls", "Direction requests"],
    sourceMatchers: ["gbp", "google_business", "google_local"],
    hasAdapter: false,
  },
  {
    id: "organic",
    label: "Organic / SEO",
    category: "organic",
    description: "Unpaid search and direct traffic — no ad spend to track, but real leads and revenue still count.",
    imports: ["Landing pages", "Search rankings (if connected via Search Console later)"],
    sourceMatchers: ["organic", "direct", "seo"],
    hasAdapter: false,
  },
  {
    id: "referral",
    label: "Referrals",
    category: "organic",
    description: "Word-of-mouth and partner referrals.",
    imports: ["Referral source", "Referred leads"],
    sourceMatchers: ["referral"],
    hasAdapter: false,
  },
  {
    id: "other",
    label: "Other / Custom Source",
    category: "organic",
    description: "Any acquisition source not covered above — still tracked via UTM attribution.",
    imports: ["Whatever UTM parameters the source sends"],
    sourceMatchers: [],
    hasAdapter: false,
  },
];

export type ConnectionStatus = "connected" | "not_connected";

export function channelConnectionStatus(channel: ChannelDefinition): ConnectionStatus {
  if (!channel.hasAdapter) return "not_connected";
  if (channel.id === "meta") return new MetaAdapter().isConfigured() ? "connected" : "not_connected";
  if (channel.id === "google_ads") return new GoogleAdsAdapter().isConfigured() ? "connected" : "not_connected";
  return "not_connected";
}

// Maps a real attribution `source` string (as stored, e.g. from
// campaignPerformance() rows) onto a channel id. Falls through to "other"
// rather than fabricating a more specific match — the only channels with
// real spend/data are the ones a row's source actually matches.
export function channelForSource(source: string): ChannelDefinition {
  const normalized = source.toLowerCase();
  return CHANNELS.find((c) => c.sourceMatchers.includes(normalized)) ?? CHANNELS.find((c) => c.id === "other")!;
}
