"use client";

const VISITOR_KEY = "pip_visitor_id";
const LEAD_KEY = "pip_lead_id";
const LEAD_TOKEN_KEY = "pip_lead_token";
const ANALYTICS_SESSION_KEY = "pip_analytics_session";

export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

export function getStoredLeadId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LEAD_KEY);
}

export function storeLeadId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEAD_KEY, id);
}

/**
 * The server-issued ownership capability for the current lead
 * (src/lib/funnel-capability.ts) — required on every subsequent request
 * that references a `leadId`, so a bare leadId is never sufficient proof
 * of ownership on its own.
 */
export function getStoredLeadToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LEAD_TOKEN_KEY);
}

export function storeLeadToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEAD_TOKEN_KEY, token);
}

export function getOrCreateAnalyticsSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.sessionStorage.getItem(ANALYTICS_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, id);
  }
  return id;
}

export async function track(
  eventType: string,
  opts: {
    leadId?: string | null;
    funnelStep?: string;
    eventKey?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  if (typeof window === "undefined") return;
  const visitorId = getOrCreateVisitorId();
  const analyticsSessionId = getOrCreateAnalyticsSessionId();
  await fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitorId,
      eventType,
      url: window.location.href,
      referrer: document.referrer || null,
      leadId: opts.leadId ?? getStoredLeadId(),
      leadToken: getStoredLeadToken(),
      analyticsSessionId,
      eventKey: opts.eventKey ?? `browser:${analyticsSessionId}:${eventType}`,
      funnelStep: opts.funnelStep,
      metadata: opts.metadata,
    }),
    keepalive: true,
  }).catch(() => {});
}

export function attributionFromLocation() {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
    landingPage: window.location.pathname,
    clickId:
      params.get("gclid") ?? params.get("fbclid") ?? params.get("msclkid") ?? null,
    gclid: params.get("gclid"),
    fbclid: params.get("fbclid"),
    referrer: document.referrer ? new URL(document.referrer).host : null,
  };
}
