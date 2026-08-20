import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getDashboardMetrics } from "@/lib/dashboard-metrics";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const metrics = await getDashboardMetrics(session.companyId);
  return NextResponse.json(metrics);
}
