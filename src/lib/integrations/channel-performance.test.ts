import { describe, expect, it } from "vitest";
import { computeChannelPerformance, type MarketingPerformanceRow } from "./channel-performance";
import { channelForSource, channelConnectionStatus, CHANNELS } from "./channels";

function row(overrides: Partial<MarketingPerformanceRow>): MarketingPerformanceRow {
  return {
    source: "google", medium: "cpc", campaign: "test", content: "Unspecified",
    spendCents: null, visitors: 0, leads: 0, qualified: 0, booked: 0, completed: 0, customers: 0,
    revenueCents: null,
    ...overrides,
  };
}

describe("channelForSource", () => {
  it("maps known sources to their channel", () => {
    expect(channelForSource("facebook").id).toBe("meta");
    expect(channelForSource("google").id).toBe("google_ads");
    expect(channelForSource("direct").id).toBe("organic");
  });

  it("is case-insensitive", () => {
    expect(channelForSource("Facebook").id).toBe("meta");
  });

  it("falls back to 'other' for an unmapped source, never fabricating a more specific match", () => {
    expect(channelForSource("some_random_unknown_source").id).toBe("other");
  });
});

describe("channelConnectionStatus", () => {
  it("reports not_connected for every channel without real credentials configured", () => {
    for (const channel of CHANNELS) {
      expect(channelConnectionStatus(channel)).toBe("not_connected");
    }
  });

  it("channels without an adapter are always not_connected, never fabricated as connected", () => {
    const noAdapterChannels = CHANNELS.filter((c) => !c.hasAdapter);
    expect(noAdapterChannels.length).toBeGreaterThan(0);
    for (const channel of noAdapterChannels) {
      expect(channelConnectionStatus(channel)).toBe("not_connected");
    }
  });
});

describe("computeChannelPerformance", () => {
  it("buckets real rows into the correct channel by source", () => {
    const result = computeChannelPerformance([
      row({ source: "facebook", leads: 5, visitors: 20 }),
      row({ source: "google", leads: 3, visitors: 10 }),
    ]);
    const meta = result.find((c) => c.channel.id === "meta");
    const googleAds = result.find((c) => c.channel.id === "google_ads");
    expect(meta?.leads).toBe(5);
    expect(googleAds?.leads).toBe(3);
  });

  it("reports spendCents null when no row in the channel has logged spend (never fabricates $0)", () => {
    const result = computeChannelPerformance([row({ source: "facebook", leads: 5, spendCents: null })]);
    const meta = result.find((c) => c.channel.id === "meta");
    expect(meta?.spendCents).toBeNull();
  });

  it("sums real spend when present", () => {
    const result = computeChannelPerformance([
      row({ source: "facebook", spendCents: 10000, leads: 2 }),
      row({ source: "facebook", spendCents: 5000, leads: 1 }),
    ]);
    const meta = result.find((c) => c.channel.id === "meta");
    expect(meta?.spendCents).toBe(15000);
    expect(meta?.leads).toBe(3);
  });

  it("computes CAC/ROAS/ROI only when both spend and revenue are known", () => {
    const result = computeChannelPerformance([row({ source: "facebook", spendCents: 10000, customers: 2, revenueCents: 40000 })]);
    const meta = result.find((c) => c.channel.id === "meta");
    expect(meta?.cac).toBe(5000);
    expect(meta?.roas).toBe(4);
  });

  it("excludes channels with no activity at all (no fabricated empty-channel rows)", () => {
    const result = computeChannelPerformance([row({ source: "facebook", leads: 1, visitors: 1 })]);
    expect(result.some((c) => c.channel.id === "sms")).toBe(false);
  });

  it("returns an empty array for no rows (honest empty state, no invented channels)", () => {
    expect(computeChannelPerformance([])).toEqual([]);
  });
});
