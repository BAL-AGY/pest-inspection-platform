/**
 * Next.js startup hook (https://nextjs.org/docs/app/guides/instrumentation)
 * — runs once when the server process starts, before it accepts any
 * request. Used here to fail fast in production when a required secret is
 * invalid, instead of only discovering it on the first live request.
 */
import { assertProductionEnvironment } from "@/lib/environment";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    assertProductionEnvironment();
  }
}


/**
 * Provider-neutral server error hook. It deliberately omits error messages,
 * request headers, query strings, and bodies because any of them can contain
 * homeowner PII or infrastructure credentials. A future monitoring adapter
 * can consume the same structured fields.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error
    ? String(error.digest)
    : undefined;
  console.error(JSON.stringify({
    level: "error",
    event: "server_request_failed",
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    errorType: error instanceof Error ? error.name : "UnknownError",
    ...(digest ? { digest } : {}),
    timestamp: new Date().toISOString(),
  }));
};
