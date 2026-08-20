/**
 * Next.js startup hook (https://nextjs.org/docs/app/guides/instrumentation)
 * — runs once when the server process starts, before it accepts any
 * request. Used here to fail fast in production when a required secret is
 * missing, instead of only discovering it on the first live request to
 * the public funnel (src/lib/funnel-capability.ts already fails closed
 * per-request too, as defense in depth if this hook is ever bypassed).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    if (!process.env.FUNNEL_CAPABILITY_SECRET) {
      throw new Error(
        "FUNNEL_CAPABILITY_SECRET must be set in production (no fallback to AUTH_SECRET is used in production) — see .env.example and docs/ARCHITECTURE.md. Refusing to start.",
      );
    }
  }
}
