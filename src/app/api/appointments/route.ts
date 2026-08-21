import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getActiveCompany,
  parseBusinessHours,
  parseCompanyTimeZone,
  parseServiceZipCodes,
  parseSupportedPests,
} from "@/lib/company";
import {
  appointmentCompanyDayRange,
  assertSlotBookable,
  CapacityExceededError,
  DoubleBookingError,
} from "@/lib/scheduling";
import { deriveQualificationState, parseStoredQualificationAnswers } from "@/lib/qualification";
import { requireSession } from "@/lib/require-session";
import { MESSAGE_TEMPLATES } from "@/lib/communications";
import { sendIfAllowed } from "@/lib/suppression";
import { verifyLeadToken } from "@/lib/funnel-capability";
import { enforceRateLimit, rateLimitResponse, trustedClientAddress } from "@/lib/rate-limit";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { attributionFromLead, recordFunnelEvent } from "@/lib/analytics-events";

const bookSchema = z.object({
  leadId: z.string().min(1),
  leadToken: z.string().min(1),
  start: z.string().datetime(),
  // Accepted for backward/display compatibility but never trusted — the
  // server always derives the authoritative end from
  // start + company.inspectionDurationMinutes (see docs/GOAL_AUDIT.md).
  end: z.string().datetime().optional(),
  inspectorId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { leadId, leadToken, start, inspectorId } = parsed.data;

  const company = await getActiveCompany();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // A bare leadId is never sufficient proof this caller may book/consume
  // this lead's inspection slot (see src/lib/funnel-capability.ts).
  const owns = verifyLeadToken({
    companyId: company.id,
    leadId: lead.id,
    visitorId: lead.visitorId ?? "",
    token: leadToken,
  });
  if (!owns) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limit = await enforceRateLimit({
    policy: "booking",
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
      { error: "not_eligible", reason: "Lead is not eligible to book an inspection yet." },
      { status: 403 },
    );
  }

  // An inspectorId, if supplied, must actually belong to this company and
  // be active — never trust an opaque client-supplied id (see
  // docs/GOAL_AUDIT.md: cross-tenant inspector usage / inactive inspector).
  let inspector = null;
  if (inspectorId) {
    inspector = await prisma.inspector.findFirst({
      where: { id: inspectorId, companyId: company.id, active: true },
    });
    if (!inspector) {
      return NextResponse.json(
        { error: "invalid_inspector", reason: "Selected inspector is not available." },
        { status: 400 },
      );
    }
  }

  const requestedStart = new Date(start);
  // Authoritative end is always derived server-side from the company's
  // configured duration — a client can't submit a zero, negative,
  // shortened, or lengthened appointment (see docs/GOAL_AUDIT.md).
  const requestedEnd = new Date(requestedStart.getTime() + company.inspectionDurationMinutes * 60_000);
  const businessHours = parseBusinessHours(company);
  const timeZone = parseCompanyTimeZone(company);
  const { start: dayStart, end: dayEnd } = appointmentCompanyDayRange(requestedStart, timeZone);

  const loadDayAppointments = async (client: Prisma.TransactionClient | typeof prisma) => {
    const rows = await client.appointment.findMany({
      where: {
        companyId: company.id,
        status: { in: ["booked", "rescheduled"] },
        scheduledStart: { gte: dayStart, lt: dayEnd },
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });
    return rows.map((a) => ({ start: a.scheduledStart, end: a.scheduledEnd }));
  };

  try {
    assertSlotBookable({
      requested: { start: requestedStart, end: requestedEnd },
      existingAppointments: await loadDayAppointments(prisma),
      businessHours,
      maxDailyInspections: company.maxDailyInspections,
      durationMinutes: company.inspectionDurationMinutes,
      timeZone,
    });
  } catch (err) {
    if (err instanceof DoubleBookingError) {
      return NextResponse.json({ error: "double_booked", reason: err.message }, { status: 409 });
    }
    if (err instanceof CapacityExceededError) {
      return NextResponse.json({ error: "capacity_exceeded", reason: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "not_bookable", reason: err instanceof Error ? err.message : "Invalid slot" },
      { status: 400 },
    );
  }

  let appointment;
  try {
    appointment = await runSerializableTransaction(
      async (tx) => {
        // Authoritative, immediately-before-insert re-check, run again
        // inside the transaction to close almost all of the TOCTOU window
        // between the pre-check above and the write below (see
        // docs/GOAL_AUDIT.md and docs/ARCHITECTURE.md for the full
        // concurrency-guarantee writeup, including what's PostgreSQL-only
        // and not provable under this environment's SQLite).
        assertSlotBookable({
          requested: { start: requestedStart, end: requestedEnd },
          existingAppointments: await loadDayAppointments(tx),
          businessHours,
          maxDailyInspections: company.maxDailyInspections,
          durationMinutes: company.inspectionDurationMinutes,
          timeZone,
        });

        const created = await tx.appointment.create({
          data: {
            companyId: company.id,
            leadId: lead.id,
            isDemo: lead.isDemo,
            inspectorId: inspector?.id ?? null,
            scheduledStart: requestedStart,
            scheduledEnd: requestedEnd,
            status: "booked",
          },
        });
        await tx.lead.update({ where: { id: lead.id }, data: { status: "inspection_booked" } });
        await recordFunnelEvent({
          companyId: company.id,
          leadId: lead.id,
          appointmentId: created.id,
          visitorId: lead.visitorId ?? lead.id,
          eventType: "inspection_booked",
          eventKey: `appointment:${created.id}:booked`,
          funnelStep: "booked",
          isDemo: lead.isDemo,
          attribution: attributionFromLead(lead),
        }, tx);
        return created;
      },
    );
  } catch (err) {
    // Final, atomic backstop against a genuinely concurrent request that
    // beat the in-transaction re-check above: the partial unique DB index
    // on (companyId, scheduledStart) for active appointments (see
    // prisma/schema.prisma) turns a same-slot race into a P2002 here,
    // proven by the PostgreSQL concurrency suite. P2034 is returned only
    // after the bounded serializable retry policy is exhausted.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "double_booked", reason: "This time slot was just taken." },
        { status: 409 },
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return NextResponse.json(
        { error: "conflict", reason: "This booking conflicted with another request — please try again." },
        { status: 409 },
      );
    }
    if (err instanceof DoubleBookingError) {
      return NextResponse.json({ error: "double_booked", reason: err.message }, { status: 409 });
    }
    if (err instanceof CapacityExceededError) {
      return NextResponse.json({ error: "capacity_exceeded", reason: err.message }, { status: 409 });
    }
    throw err;
  }

  const when = requestedStart.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const consent = {
    emailConsent: lead.emailConsent,
    smsConsent: lead.smsConsent,
    smsMarketingConsent: lead.smsMarketingConsent,
    emailMarketingConsent: lead.emailMarketingConsent,
    smsOptedOutAt: lead.smsOptedOutAt,
    emailOptedOutAt: lead.emailOptedOutAt,
    optedOutAt: lead.optedOutAt,
  };
  const name = lead.firstName ?? "there";
  if (lead.email) {
    await sendIfAllowed(
      {
        channel: "email",
        to: lead.email,
        subject: "Your free home pest inspection is confirmed",
        body: MESSAGE_TEMPLATES.appointmentConfirmation({ name, when }),
      },
      {
        companyId: company.id,
        leadId: lead.id,
        appointmentId: appointment.id,
        type: "appointment_confirmation",
        purpose: "transactional",
        dedupeKey: `appointment:${appointment.id}:confirmation:email`,
        consent,
      },
    );
  }
  if (lead.phone) {
    await sendIfAllowed(
      {
        channel: "sms",
        to: lead.phone,
        body: MESSAGE_TEMPLATES.appointmentConfirmation({ name, when }),
      },
      {
        companyId: company.id,
        leadId: lead.id,
        appointmentId: appointment.id,
        type: "appointment_confirmation",
        purpose: "transactional",
        dedupeKey: `appointment:${appointment.id}:confirmation:sms`,
        consent,
      },
    );
  }

  return NextResponse.json({ appointment });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");

  const appointments = await prisma.appointment.findMany({
    where: {
      companyId: session.companyId,
      ...(startParam && endParam
        ? { scheduledStart: { gte: new Date(startParam), lte: new Date(endParam) } }
        : {}),
    },
    include: { lead: true, inspector: true },
    orderBy: { scheduledStart: "asc" },
  });

  return NextResponse.json({ appointments });
}
