import { NextResponse } from "next/server";
import { checkOperationalReadiness } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkOperationalReadiness();
  if (!result.ready) {
    console.error(JSON.stringify({
      level: "error",
      event: "readiness_check_failed",
      failedChecks: result.failedChecks,
      timestamp: new Date().toISOString(),
    }));
  }
  return NextResponse.json(
    { status: result.ready ? "ready" : "not_ready" },
    {
      status: result.ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
