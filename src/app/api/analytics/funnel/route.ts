import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { computeFunnelCounts, computeStageConversionRates } from "@/lib/analytics";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const events = await prisma.funnelEvent.findMany({
    where: { companyId: session.companyId },
    select: { eventType: true, source: true, campaign: true },
  });

  const overall = computeFunnelCounts(events);
  const overallRates = computeStageConversionRates(overall);

  const bySource = new Map<string, { eventType: string }[]>();
  for (const e of events) {
    const key = e.source ?? "unknown";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(e);
  }

  const sourceBreakdown = Array.from(bySource.entries()).map(([source, sourceEvents]) => ({
    source,
    counts: computeFunnelCounts(sourceEvents),
  }));

  return NextResponse.json({ overall, overallRates, sourceBreakdown });
}
