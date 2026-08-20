import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveCompany, parseBusinessHours, parseServiceZipCodes } from "@/lib/company";
import { assertSlotBookable, DoubleBookingError } from "@/lib/scheduling";
import { isInServiceArea } from "@/lib/qualification";
import { requireSession } from "@/lib/require-session";
import { MESSAGE_TEMPLATES } from "@/lib/communications";
import { sendIfAllowed } from "@/lib/suppression";

const bookSchema = z.object({
  leadId: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  inspectorId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { leadId, start, end, inspectorId } = parsed.data;

  const company = await getActiveCompany();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const serviceZipCodes = parseServiceZipCodes(company);
  const inArea = isInServiceArea(lead.zipCode ?? undefined, serviceZipCodes);
  if (lead.classification !== "sql" || !inArea) {
    return NextResponse.json(
      { error: "not_eligible", reason: "Lead is not eligible to book an inspection yet." },
      { status: 403 },
    );
  }

  const requestedStart = new Date(start);
  const requestedEnd = new Date(end);
  const businessHours = parseBusinessHours(company);

  const dayStart = new Date(requestedStart);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(requestedStart);
  dayEnd.setHours(23, 59, 59, 999);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      companyId: company.id,
      status: { in: ["booked", "rescheduled"] },
      scheduledStart: { gte: dayStart, lte: dayEnd },
    },
    select: { scheduledStart: true, scheduledEnd: true },
  });

  try {
    assertSlotBookable({
      requested: { start: requestedStart, end: requestedEnd },
      existingAppointments: existingAppointments.map((a) => ({
        start: a.scheduledStart,
        end: a.scheduledEnd,
      })),
      businessHours,
      maxDailyInspections: company.maxDailyInspections,
    });
  } catch (err) {
    if (err instanceof DoubleBookingError) {
      return NextResponse.json({ error: "double_booked", reason: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "not_bookable", reason: err instanceof Error ? err.message : "Invalid slot" },
      { status: 400 },
    );
  }

  let appointment;
  try {
    appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          inspectorId: inspectorId ?? null,
          scheduledStart: requestedStart,
          scheduledEnd: requestedEnd,
          status: "booked",
        },
      });
      await tx.lead.update({ where: { id: lead.id }, data: { status: "inspection_booked" } });
      await tx.funnelEvent.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          visitorId: lead.visitorId ?? lead.id,
          eventType: "appointment_booked",
          source: lead.source,
          medium: lead.medium,
          campaign: lead.campaign,
        },
      });
      return created;
    });
  } catch (err) {
    // DB-level unique(inspectorId, scheduledStart) constraint is the final
    // guard against a race between the check above and this write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "double_booked", reason: "This time slot was just taken." },
        { status: 409 },
      );
    }
    throw err;
  }

  const when = requestedStart.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: company.timezone,
  });
  const consent = {
    emailConsent: lead.emailConsent,
    smsConsent: lead.smsConsent,
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
      { companyId: company.id, consent },
    );
  }
  if (lead.phone) {
    await sendIfAllowed(
      {
        channel: "sms",
        to: lead.phone,
        body: MESSAGE_TEMPLATES.appointmentConfirmation({ name, when }),
      },
      { companyId: company.id, consent },
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
