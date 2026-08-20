"use client";

const VISITOR_KEY = "pip_visitor_id";
const LEAD_KEY = "pip_lead_id";
const LEAD_TOKEN_KEY = "pip_lead_token";

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

export async function track(
  eventType: string,
  opts: { leadId?: string | null; metadata?: Record<string, unknown> } = {},
) {
  if (typeof window === "undefined") return;
  const visitorId = getOrCreateVisitorId();
  await fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitorId,
      eventType,
      url: window.location.href,
      referrer: document.referrer || null,
      leadId: opts.leadId ?? getStoredLeadId(),
      metadata: opts.metadata,
    }),
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
  };
}
