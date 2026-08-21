import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

const schema = z.object({
  source: z.string().min(1),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  content: z.string().optional(),
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
  const { source, medium, campaign, content, periodStart, periodEnd, amountCents } = parsed.data;
  if (new Date(periodStart) > new Date(periodEnd)) {
    return NextResponse.json({ error: "periodStart must not be after periodEnd" }, { status: 400 });
  }
  const company = await prisma.company.findUnique({ where: { id: session.companyId }, select: { isDemo: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const entry = await prisma.marketingSpend.create({
    data: {
      companyId: session.companyId,
      isDemo: company.isDemo,
      source,
      medium,
      campaign,
      content,
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

  const company = await prisma.company.findUnique({ where: { id: session.companyId }, select: { isDemo: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const entries = await prisma.marketingSpend.findMany({
    where: { companyId: session.companyId, isDemo: company.isDemo },
    orderBy: { periodStart: "desc" },
  });

  return NextResponse.json({ entries });
}
