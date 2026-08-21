/**
 * Next.js startup hook (https://nextjs.org/docs/app/guides/instrumentation)
 * — runs once when the server process starts, before it accepts any
 * request. Used here to fail fast in production when a required secret is
 * invalid, instead of only discovering it on the first live request.
 */
import { assertProductionEnvironment } from "@/lib/environment";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    assertProductionEnvironment();
  }
}
