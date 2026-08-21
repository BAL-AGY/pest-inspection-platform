import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getDashboardMetrics } from "@/lib/dashboard-metrics";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const metrics = await getDashboardMetrics(session.companyId, {
    preset: req.nextUrl.searchParams.get("range") ?? undefined,
    start: req.nextUrl.searchParams.get("start") ?? undefined,
    end: req.nextUrl.searchParams.get("end") ?? undefined,
  });
  return NextResponse.json({ range: metrics.range, funnel: metrics.funnelStages, dropOff: metrics.questionDropOff, marketingPerformance: metrics.marketingPerformance });
}
