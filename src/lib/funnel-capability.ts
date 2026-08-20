/**
 * Ownership capability for the anonymous public funnel. Closes an IDOR
 * gap confirmed against the actual code (see docs/GOAL_AUDIT.md): the
 * public lead/booking routes previously trusted a bare `leadId` as proof
 * of ownership — anyone who obtained a lead's id (log, shared device,
 * leaked URL — `GET /api/availability?leadId=` puts it in the query
 * string) could read/rewrite that lead's contact info and consent, or
 * book/consume its inspection slot, with nothing tying the request to the
 * visitor who actually created it.
 *
 * Every lead-scoped response includes an HMAC-signed capability token
 * derived from (companyId, leadId, visitorId, issuedAt) using a
 * server-only secret. The token proves the caller was handed it by this
 * server for this exact lead+visitor pair — it can't be forged or derived
 * from the leadId alone, and it expires (see `LEAD_TOKEN_TTL_MS` below).
 *
 * IMPORTANT — server-only module. Never import this from a "use client"
 * component or any code path that could bundle it into client JS; doing
 * so would ship `FUNNEL_CAPABILITY_SECRET`/`AUTH_SECRET` reads into the
 * browser. Next.js already keeps non-`NEXT_PUBLIC_`-prefixed env vars out
 * of client bundles, but this file should only ever be imported from
 * `src/app/api/**` route handlers.
 *
 * SECRET: see `getSecret()` below for production-vs-dev behavior.
 *
 * LIFETIME: tokens embed a plaintext (unauthenticated but tamper-evident —
 * it's covered by the HMAC) `iat` timestamp and are rejected once older
 * than `LEAD_TOKEN_TTL_MS`. Every successful lead-scoped response
 * re-issues a fresh token, so an actively continuing visitor never
 * approaches the limit — it only bounds how long a *stolen* token (e.g.
 * exfiltrated via an XSS bug elsewhere on the page) remains replayable
 * after the fact.
 *
 * STORAGE — known, documented limitation: the client stores this token in
 * `localStorage` (src/lib/visitor.ts), which is readable by any script
 * that can execute in the page's origin. This does NOT provide meaningful
 * protection against an active XSS attacker — an attacker who can run JS
 * in the page can simply issue authenticated fetches directly, with or
 * without being able to read the token value first. What TTL + localStorage
 * together provide is: (a) a token that leaks via logs, a shared device,
 * or a since-patched XSS bug has a bounded, not indefinite, useful
 * lifetime, and (b) no *additional* exposure beyond what any client-side
 * XSS already grants. The correct stronger fix — not implemented here, to
 * avoid redesigning the funnel's request/response contract in the same
 * change that fixed the IDOR and duration/concurrency bugs — is to move
 * this token to an `httpOnly`, `Secure`, `SameSite=Lax` cookie set by the
 * server, which at minimum prevents *exfiltration* of the token for reuse
 * outside the compromised page/session (it does not, on its own, stop an
 * in-session XSS attacker from acting as the visitor while the page is
 * still open — that would additionally need CSRF-aware design, since
 * cookies are attached automatically). See docs/ARCHITECTURE.md.
 */

import crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";

/**
 * How long an issued lead-ownership token remains valid, in milliseconds.
 * 4 hours comfortably covers completing the funnel in one extended
 * sitting (including interruptions), while still meaningfully bounding
 * the replay window of a token that leaked some other way.
 */
export const LEAD_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

function getSecret(): string {
  const dedicated = process.env.FUNNEL_CAPABILITY_SECRET;
  if (dedicated) return dedicated;

  if (isProduction) {
    // Fail closed. Production must never derive funnel-ownership tokens
    // from a fallback/shared secret: reusing AUTH_SECRET here would couple
    // two unrelated trust domains (staff session signing vs. anonymous
    // funnel ownership — rotating one would unintentionally affect the
    // other), and silently falling back risks a well-known development
    // placeholder value ending up in production. This is intentionally a
    // hard throw, not a warning — every request touching the public
    // funnel fails until the operator sets FUNNEL_CAPABILITY_SECRET. See
    // the `register()` check in src/instrumentation.ts for the
    // fail-at-startup version of this same guarantee, and
    // docs/ARCHITECTURE.md for the required production env var.
    throw new Error(
      "FUNNEL_CAPABILITY_SECRET is required in production and has no fallback. Set it before serving traffic.",
    );
  }

  // Dev/test convenience only, and unreachable in production (see above):
  // falls back to AUTH_SECRET so local setup doesn't need a second secret.
  const devFallback = process.env.AUTH_SECRET;
  if (!devFallback) {
    throw new Error(
      "FUNNEL_CAPABILITY_SECRET (or AUTH_SECRET, dev/test only) must be set to issue/verify funnel capability tokens.",
    );
  }
  return devFallback;
}

interface CapabilityParams {
  companyId: string;
  leadId: string;
  visitorId: string;
}

function sign(params: CapabilityParams, issuedAtMs: number): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${params.companyId}:${params.leadId}:${params.visitorId}:${issuedAtMs}`)
    .digest("base64url");
}

/** `{issuedAtMs}.{signature}` — the timestamp is plaintext but tamper-evident (covered by the HMAC). */
export function issueLeadToken(params: CapabilityParams): string {
  const issuedAtMs = Date.now();
  return `${issuedAtMs}.${sign(params, issuedAtMs)}`;
}

/**
 * Verifies a client-supplied token against the lead's actual, server-side
 * `visitorId` (never the client's claimed visitorId) using a
 * constant-time comparison, and rejects it once expired. Returns false
 * for any missing/malformed/wrong/expired token — callers must treat that
 * as "not this caller's lead," not as "lead not found," to avoid leaking
 * existence via a different error path.
 */
export function verifyLeadToken(params: CapabilityParams & { token: string | null | undefined }): boolean {
  if (!params.token) return false;

  const dotIndex = params.token.indexOf(".");
  if (dotIndex < 1) return false;
  const issuedAtRaw = params.token.slice(0, dotIndex);
  const signature = params.token.slice(dotIndex + 1);
  if (!signature) return false;

  const issuedAtMs = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAtMs)) return false;

  const now = Date.now();
  if (issuedAtMs > now) return false; // reject a future-dated token (clock-skew tampering)
  if (now - issuedAtMs > LEAD_TOKEN_TTL_MS) return false; // expired

  const expected = sign(params, issuedAtMs);
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signature);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
