import { describe, expect, it } from "vitest";
import { parseAttribution, resolveAttribution } from "./attribution";

describe("parseAttribution", () => {
  it("parses standard UTM params", () => {
    const attr = parseAttribution(
      "https://example.com/free-inspection?utm_source=google&utm_medium=cpc&utm_campaign=summer_pests&utm_content=ad1&utm_term=pest+control",
    );
    expect(attr).toMatchObject({
      source: "google",
      medium: "cpc",
      campaign: "summer_pests",
      content: "ad1",
      term: "pest control",
      landingPage: "/free-inspection",
    });
  });

  it("infers source from a Google click id when utm_source is absent", () => {
    const attr = parseAttribution("https://example.com/?gclid=abc123");
    expect(attr.source).toBe("google");
    expect(attr.clickId).toBe("abc123");
  });

  it("infers source from a Facebook click id", () => {
    const attr = parseAttribution("https://example.com/?fbclid=xyz");
    expect(attr.source).toBe("facebook");
  });

  it("returns null source with no params", () => {
    const attr = parseAttribution("https://example.com/");
    expect(attr.source).toBeNull();
    expect(attr.clickId).toBeNull();
  });
});

describe("resolveAttribution", () => {
  it("keeps parsed source when present", () => {
    const resolved = resolveAttribution(
      {
        source: "google",
        medium: "cpc",
        campaign: null,
        content: null,
        term: null,
        landingPage: "/",
        clickId: null,
        gclid: null, fbclid: null, referrer: null,
      },
      "www.bing.com",
    );
    expect(resolved.source).toBe("google");
  });

  it("falls back to referrer host as source/referral medium", () => {
    const resolved = resolveAttribution(
      {
        source: null,
        medium: null,
        campaign: null,
        content: null,
        term: null,
        landingPage: "/",
        clickId: null,
        gclid: null, fbclid: null, referrer: null,
      },
      "www.yelp.com",
    );
    expect(resolved.source).toBe("www.yelp.com");
    expect(resolved.medium).toBe("referral");
  });

  it("falls back to direct/none with no referrer and no params", () => {
    const resolved = resolveAttribution(
      {
        source: null,
        medium: null,
        campaign: null,
        content: null,
        term: null,
        landingPage: "/",
        clickId: null,
        gclid: null, fbclid: null, referrer: null,
      },
      null,
    );
    expect(resolved.source).toBe("direct");
    expect(resolved.medium).toBe("none");
  });
});
