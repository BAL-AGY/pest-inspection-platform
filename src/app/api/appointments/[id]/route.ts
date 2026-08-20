import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveCompany, parseBusinessHours } from "@/lib/company";
import { assertSlotBookable, DoubleBookingError } from "@/lib/scheduling";
import { requireSession } from "@/lib/require-session";
import { MESSAGE_TEMPLATES } from "@/lib/communications";
import { sendIfAllowed } from "@/lib/suppression";
import { cancelAppointmentAndNotify } from "@/lib/appointment-actions";

const patchSchema = z.object({
  action: z.enum(["reschedule", "cancel", "no_show", "complete"]),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { action, start, end } = parsed.data;

  const appointment = await prisma.appointment.findFirst({
    where: { id, companyId: session.companyId },
    include: { lead: true },
  });
  if (!appointment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const company = await getActiveCompany();
  const consent = {
    emailConsent: appointment.lead.emailConsent,
    smsConsent: appointment.lead.smsConsent,
    optedOutAt: appointment.lead.optedOutAt,
  };
  const name = appointment.lead.firstName ?? "there";
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: company.timezone,
    });

  if (action === "reschedule") {
    if (!start || !end) {
      return NextResponse.json({ error: "start and end are required" }, { status: 400 });
    }
    const requestedStart = new Date(start);
    const requestedEnd = new Date(end);
    const dayStart = new Date(requestedStart);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(requestedStart);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await prisma.appointment.findMany({
      where: {
        companyId: session.companyId,
        id: { not: id },
        status: { in: ["booked", "rescheduled"] },
        scheduledStart: { gte: dayStart, lte: dayEnd },
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });

    try {
      assertSlotBookable({
        requested: { start: requestedStart, end: requestedEnd },
        existingAppointments: existing.map((a) => ({ start: a.scheduledStart, end: a.scheduledEnd })),
        businessHours: parseBusinessHours(company),
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

    const updated = await prisma.appointment.update({
      where: { id },
      data: { scheduledStart: requestedStart, scheduledEnd: requestedEnd },
    });
    await prisma.auditLog.create({
      data: {
        companyId: session.companyId,
        action: "rescheduled",
        entityType: "Appointment",
        entityId: id,
        metadata: JSON.stringify({ from: appointment.scheduledStart, to: requestedStart }),
      },
    });
    if (appointment.lead.email) {
      await sendIfAllowed(
        {
          channel: "email",
          to: appointment.lead.email,
          subject: "Your inspection has been rescheduled",
          body: MESSAGE_TEMPLATES.rescheduled({ name, when: fmt(requestedStart) }),
        },
        {
          companyId: session.companyId,
          leadId: appointment.leadId,
          appointmentId: appointment.id,
          type: "appointment_rescheduled",
          consent,
        },
      );
    }
    return NextResponse.json({ appointment: updated });
  }

  if (action === "cancel") {
    const updated = await cancelAppointmentAndNotify(id, session.companyId);
    return NextResponse.json({ appointment: updated });
  }

  if (action === "no_show") {
    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: "no_show" },
    });
    return NextResponse.json({ appointment: updated });
  }

  // complete
  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: "completed", completedAt: new Date() },
  });
  await prisma.lead.update({
    where: { id: appointment.leadId },
    data: { status: "inspection_completed" },
  });
  await prisma.funnelEvent.create({
    data: {
      companyId: session.companyId,
      leadId: appointment.leadId,
      visitorId: appointment.lead.visitorId ?? appointment.leadId,
      eventType: "appointment_completed",
    },
  });
  return NextResponse.json({ appointment: updated });
}
