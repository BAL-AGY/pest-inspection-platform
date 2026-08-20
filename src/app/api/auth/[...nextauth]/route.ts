import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import {
  enforceRateLimit,
  publicCompanyRateLimitScope,
  rateLimitResponse,
  trustedClientAddress,
} from "@/lib/rate-limit";

export const GET = handlers.GET;

export async function POST(req: NextRequest) {
  // Clone before inspecting so Auth.js still receives the untouched body.
  // Credentials callbacks are additionally bucketed by normalized account
  // identifier; other auth actions fall back to the CSRF/session cookie.
  let authSubject: string | null =
    req.cookies.get("authjs.csrf-token")?.value ??
    req.cookies.get("__Host-authjs.csrf-token")?.value ??
    null;
  try {
    const form = await req.clone().formData();
    const email = form.get("email");
    if (typeof email === "string" && email.trim()) authSubject = email.trim().toLowerCase();
  } catch {
    // Not every Auth.js POST action is form-encoded. Network/global buckets
    // still apply, and Auth.js remains authoritative for request parsing.
  }

  const limit = await enforceRateLimit({
    policy: "auth",
    companyScope: publicCompanyRateLimitScope(),
    identifiers: [
      { kind: "session", value: authSubject },
      { kind: "network", value: trustedClientAddress(req) },
    ],
  });
  if (!limit.allowed) return rateLimitResponse(limit);
  return handlers.POST(req);
}
