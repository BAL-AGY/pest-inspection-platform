/**
 * Attribution capture: parses UTM and click-id params from an incoming
 * landing-page request so first-touch source/medium/campaign can be stored
 * on the visitor and, later, the Lead they become.
 */

export interface Attribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  landingPage: string | null;
  clickId: string | null;
  gclid: string | null;
  fbclid: string | null;
  referrer: string | null;
}

const CLICK_ID_PARAMS = ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"];

export function parseAttribution(url: string): Attribution {
  const parsed = new URL(url);
  const params = parsed.searchParams;

  let clickId: string | null = null;
  for (const key of CLICK_ID_PARAMS) {
    const value = params.get(key);
    if (value) {
      clickId = value;
      break;
    }
  }

  // Direct traffic: no utm_source and no referrer-derived source available
  // here, so this defaults to "direct" and gets refined by the caller when
  // a referrer is known.
  const source = params.get("utm_source");

  return {
    source: source ?? (clickId ? inferSourceFromClickId(clickId, params) : null),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
    landingPage: parsed.pathname,
    clickId,
    gclid: params.get("gclid"),
    fbclid: params.get("fbclid"),
    referrer: null,
  };
}

function inferSourceFromClickId(
  _clickId: string,
  params: URLSearchParams,
): string | null {
  if (params.has("gclid")) return "google";
  if (params.has("fbclid")) return "facebook";
  if (params.has("msclkid")) return "bing";
  if (params.has("ttclid")) return "tiktok";
  if (params.has("li_fat_id")) return "linkedin";
  return null;
}

/**
 * Resolves final attribution once a referrer is known, defaulting to
 * "direct"/"none" when neither UTM params nor a referrer are present.
 */
export function resolveAttribution(
  parsed: Attribution,
  referrerHost: string | null,
): Attribution {
  if (parsed.source) return parsed;
  if (referrerHost) {
    return { ...parsed, source: referrerHost, medium: parsed.medium ?? "referral", referrer: referrerHost };
  }
  return { ...parsed, source: "direct", medium: parsed.medium ?? "none" };
}
