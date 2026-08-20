import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { LEAD_STATUSES } from "@/lib/pipeline";
import { recordSuppression } from "@/lib/suppression";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      appointments: { orderBy: { scheduledStart: "desc" } },
      funnelEvents: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      communications: { orderBy: { attemptedAt: "desc" } },
    },
  });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ lead });
}

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  outcome: z.enum(["won", "lost"]).optional(),
  lostReason: z.string().optional(),
  contractValueCents: z.number().int().nonnegative().optional(),
  optedOut: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.lead.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { status, outcome, lostReason, contractValueCents, optedOut } = parsed.data;

  // Setting an outcome always advances the pipeline status to match — a
  // won/lost lead can never be left sitting in an earlier pipeline stage,
  // regardless of whether the caller also passed `status` explicitly.
  const resolvedStatus =
    outcome === "won" ? "customer_won" : outcome === "lost" ? "customer_lost" : status ?? existing.status;

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      status: resolvedStatus,
      outcome: outcome ?? existing.outcome,
      lostReason: lostReason ?? existing.lostReason,
      contractValueCents: contractValueCents ?? existing.contractValueCents,
      optedOutAt: optedOut ? new Date() : existing.optedOutAt,
    },
  });

  if (resolvedStatus !== existing.status) {
    await prisma.auditLog.create({
      data: {
        companyId: session.companyId,
        action: "status_change",
        entityType: "Lead",
        entityId: id,
        metadata: JSON.stringify({ from: existing.status, to: resolvedStatus }),
      },
    });
  }

  if (optedOut && (existing.email || existing.phone)) {
    // Persist the opt-out into the durable, cross-lead suppression system —
    // not just onto this one Lead row — so later leads/sessions from the
    // same contact inherit the protection (see docs/GOAL_AUDIT.md).
    await recordSuppression({
      companyId: session.companyId,
      channel: "all", // matches the existing undifferentiated optedOutAt semantics
      email: existing.email,
      phone: existing.phone,
      reason: "opted_out",
      source: "crm_manual_optout",
      metadata: { leadId: id },
    });
  }

  if (outcome === "won" || outcome === "lost") {
    await prisma.funnelEvent.create({
      data: {
        companyId: session.companyId,
        leadId: id,
        visitorId: existing.visitorId ?? id,
        eventType: outcome === "won" ? "customer_won" : "customer_lost",
      },
    });
  }

  return NextResponse.json({ lead });
}
