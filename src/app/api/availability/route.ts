import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getActiveCompany,
  parseBusinessHours,
  parseCompanyTimeZone,
  parseServiceZipCodes,
  parseSupportedPests,
} from "@/lib/company";
import { generateCandidateSlots, filterAvailableSlots } from "@/lib/scheduling";
import { deriveQualificationState, parseStoredQualificationAnswers } from "@/lib/qualification";
import { verifyLeadToken } from "@/lib/funnel-capability";
import { enforceRateLimit, rateLimitResponse, trustedClientAddress } from "@/lib/rate-limit";
import { addLocalCalendarDays, companyDayRange, localDateKey } from "@/lib/timezone";

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  const requestedDays = Number(req.nextUrl.searchParams.get("days") ?? "14");
  const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 180
    ? requestedDays
    : 14;
  // Sent as a header, not a query param, so it doesn't end up in browser
  // history / server access logs the way the leadId query param already
  // does (see src/lib/funnel-capability.ts).
  const leadToken = req.headers.get("x-funnel-token");

  if (!leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  }

  const company = await getActiveCompany();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const owns = verifyLeadToken({
    companyId: company.id,
    leadId: lead.id,
    visitorId: lead.visitorId ?? "",
    token: leadToken,
  });
  if (!owns) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limit = await enforceRateLimit({
    policy: "availability",
    companyScope: company.slug,
    identifiers: [
      { kind: "lead", value: lead.id },
      { kind: "network", value: trustedClientAddress(req) },
    ],
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const serviceZipCodes = parseServiceZipCodes(company);
  const qualification = deriveQualificationState({
    answers: parseStoredQualificationAnswers(lead.qualificationAnswers),
    serviceZipCodes,
    supportedPests: parseSupportedPests(company),
    hasContact: Boolean(lead.email || lead.phone),
  });

  if (lead.classification !== "sql" || !qualification.eligibleForBooking) {
    return NextResponse.json(
      {
        error: "not_eligible",
        reason:
          lead.classification !== "sql" || !qualification.complete
            ? "This lead has not yet qualified for a booked inspection."
            : !qualification.inServiceArea
              ? "This address is outside the current service area."
              : !qualification.supportedPest
                ? "This pest concern is not eligible for online inspection booking."
                : qualification.answers.isHomeowner !== true
                  ? "Online inspection booking is currently available for homeowners."
                  : "Contact information is required before viewing inspection times.",
      },
      { status: 403 },
    );
  }

  const now = new Date();
  const timeZone = parseCompanyTimeZone(company);
  const rangeStart = now;
  const appointmentQueryStart = companyDayRange(now, timeZone).start;
  const rangeEnd = companyDayRange(
    addLocalCalendarDays(localDateKey(now, timeZone), days),
    timeZone,
  ).start;

  const businessHours = parseBusinessHours(company);
  const candidates = generateCandidateSlots({
    rangeStart,
    rangeEnd,
    durationMinutes: company.inspectionDurationMinutes,
    businessHours,
    timeZone,
    now,
  });

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      companyId: company.id,
      status: { in: ["booked", "rescheduled"] },
      // Include appointments earlier on the current company-local day: they
      // still consume today's daily capacity even though their slot is past.
      scheduledStart: { gte: appointmentQueryStart, lt: rangeEnd },
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
    timeZone,
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
    timeZone,
  });
}
