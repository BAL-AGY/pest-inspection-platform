import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveCompany, parseBusinessHours, parseServiceZipCodes } from "@/lib/company";
import { generateCandidateSlots, filterAvailableSlots } from "@/lib/scheduling";
import { isInServiceArea } from "@/lib/qualification";

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  const days = Number(req.nextUrl.searchParams.get("days") ?? "14");

  if (!leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  }

  const company = await getActiveCompany();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const serviceZipCodes = parseServiceZipCodes(company);
  const inArea = isInServiceArea(lead.zipCode ?? undefined, serviceZipCodes);

  if (lead.classification !== "sql" || !inArea) {
    return NextResponse.json(
      {
        error: "not_eligible",
        reason:
          lead.classification !== "sql"
            ? "This lead has not yet qualified for a booked inspection."
            : "This address is outside the current service area.",
      },
      { status: 403 },
    );
  }

  const now = new Date();
  const rangeStart = now;
  const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const businessHours = parseBusinessHours(company);
  const candidates = generateCandidateSlots({
    rangeStart,
    rangeEnd,
    durationMinutes: company.inspectionDurationMinutes,
    businessHours,
    now,
  });

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      companyId: company.id,
      status: { in: ["booked", "rescheduled"] },
      scheduledStart: { gte: rangeStart, lte: rangeEnd },
    },
    select: { scheduledStart: true, scheduledEnd: true },
  });

  const available = filterAvailableSlots({
    candidates,
    existingAppointments: existingAppointments.map((a) => ({
      start: a.scheduledStart,
      end: a.scheduledEnd,
    })),
    maxDailyInspections: company.maxDailyInspections,
  });

  await prisma.funnelEvent.create({
    data: {
      companyId: company.id,
      leadId: lead.id,
      visitorId: lead.visitorId ?? lead.id,
      eventType: "scheduler_viewed",
      source: lead.source,
      medium: lead.medium,
      campaign: lead.campaign,
    },
  });

  return NextResponse.json({
    slots: available.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  });
}
