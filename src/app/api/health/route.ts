import { NextResponse } from "next/server";
import { checkOperationalReadiness } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Stable aggregate health URL for hosting dashboards and staging smoke tests. */
export async function GET() {
  const result = await checkOperationalReadiness();
  return NextResponse.json(
    { status: result.ready ? "healthy" : "unhealthy" },
    {
      status: result.ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
