import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

const schema = z.object({
  source: z.string().min(1),
  campaign: z.string().optional(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  amountCents: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { source, campaign, periodStart, periodEnd, amountCents } = parsed.data;

  const entry = await prisma.marketingSpend.create({
    data: {
      companyId: session.companyId,
      source,
      campaign,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      amountCents,
    },
  });

  return NextResponse.json({ entry });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entries = await prisma.marketingSpend.findMany({
    where: { companyId: session.companyId },
    orderBy: { periodStart: "desc" },
  });

  return NextResponse.json({ entries });
}
