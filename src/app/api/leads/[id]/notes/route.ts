import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

const schema = z.object({ body: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await prisma.lead.findFirst({ where: { id, companyId: session.companyId } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const note = await prisma.leadNote.create({
    data: { leadId: id, body: parsed.data.body, authorId: session.email ?? null },
  });

  return NextResponse.json({ note });
}
