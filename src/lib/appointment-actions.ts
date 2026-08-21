import { prisma } from "./prisma";
import { MESSAGE_TEMPLATES } from "./communications";
import { sendIfAllowed } from "./suppression";
import { attributionFromLead, recordFunnelEvent } from "./analytics-events";

export class AppointmentNotFoundError extends Error {
  constructor() {
    super("Appointment not found.");
    this.name = "AppointmentNotFoundError";
  }
}

/**
 * Cancels an appointment, reverts the lead's pipeline status back to `sql`
 * when this was its only active appointment, and sends the cancellation
 * notification — the one place this happens so the API route and the CRM
 * UI can't drift out of sync (they previously duplicated this logic and
 * the UI path silently skipped the notification — see docs/GOAL_AUDIT.md).
 */
export async function cancelAppointmentAndNotify(appointmentId: string, companyId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId },
    include: { lead: true },
  });
  if (!appointment) throw new AppointmentNotFoundError();

  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.appointment.update({ where: { id: appointmentId }, data: { status: "cancelled", cancelledAt: new Date() } });
    await recordFunnelEvent({ companyId, leadId: appointment.leadId, appointmentId: appointment.id, visitorId: appointment.lead.visitorId ?? appointment.leadId, eventType: "inspection_cancelled", eventKey: `appointment:${appointment.id}:cancelled`, funnelStep: "cancelled", isDemo: appointment.lead.isDemo, attribution: attributionFromLead(appointment.lead) }, tx);
    const otherActive = await tx.appointment.count({
    where: {
      leadId: appointment.leadId,
      status: { in: ["booked", "rescheduled"] },
      id: { not: appointmentId },
    },
    });
    if (otherActive === 0) await tx.lead.update({
      where: { id: appointment.leadId },
      data: {
        status: appointment.lead.classification === "sql" ? "sql" : appointment.lead.status,
      },
    });
    await tx.auditLog.create({
      data: {
        companyId,
        action: "appointment_cancelled",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: JSON.stringify({ leadId: appointment.leadId, scheduledStart: appointment.scheduledStart }),
      },
    });
    return cancelled;
  });

  if (appointment.lead.email) {
    await sendIfAllowed(
      {
        channel: "email",
        to: appointment.lead.email,
        subject: "Your inspection has been cancelled",
        body: MESSAGE_TEMPLATES.cancelled({ name: appointment.lead.firstName ?? "there" }),
      },
      {
        companyId,
        leadId: appointment.leadId,
        appointmentId: appointment.id,
        type: "appointment_cancelled",
        consent: {
          emailConsent: appointment.lead.emailConsent,
          smsConsent: appointment.lead.smsConsent,
          smsMarketingConsent: appointment.lead.smsMarketingConsent,
          emailMarketingConsent: appointment.lead.emailMarketingConsent,
          smsOptedOutAt: appointment.lead.smsOptedOutAt,
          emailOptedOutAt: appointment.lead.emailOptedOutAt,
          optedOutAt: appointment.lead.optedOutAt,
        },
        purpose: "transactional",
        dedupeKey: `appointment:${appointment.id}:cancelled:email`,
      },
    );
  }

  return updated;
}

/**
 * Marks a booked appointment completed, advances the lead to
 * `inspection_completed`, and records the funnel event and audit log —
 * the one shared place for this, mirroring `cancelAppointmentAndNotify()`.
 * Before this, the CRM server action and the `PATCH /api/appointments/[id]`
 * route each independently duplicated this logic, so the API route never
 * got the audit-log entry the CRM path had, and neither path was
 * guaranteed to match the other if one changed and not the other. Only
 * ever operates on an appointment currently `status: "booked"`.
 */
export async function completeAppointmentAndLog(appointmentId: string, companyId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId, status: "booked" },
    include: { lead: true },
  });
  if (!appointment) throw new AppointmentNotFoundError();

  return prisma.$transaction(async (tx) => {
    const completed = await tx.appointment.update({ where: { id: appointmentId }, data: { status: "completed", completedAt: new Date() } });
    await tx.lead.update({ where: { id: appointment.leadId }, data: { status: "inspection_completed" } });
    await recordFunnelEvent({ companyId, leadId: appointment.leadId, appointmentId: appointment.id, visitorId: appointment.lead.visitorId ?? appointment.leadId, eventType: "inspection_completed", eventKey: `appointment:${appointment.id}:completed`, funnelStep: "completed", isDemo: appointment.lead.isDemo, attribution: attributionFromLead(appointment.lead) }, tx);
    await tx.auditLog.create({
      data: {
        companyId,
        action: "appointment_completed",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: JSON.stringify({ leadId: appointment.leadId }),
      },
    });
    return completed;
  });
}

/**
 * Marks a booked appointment as a no-show and records the audit log —
 * see `completeAppointmentAndLog()` above for why this is shared rather
 * than duplicated between the CRM and the API route. Only ever operates
 * on an appointment currently `status: "booked"`.
 */
export async function markAppointmentNoShowAndLog(appointmentId: string, companyId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId, status: "booked" },
  });
  if (!appointment) throw new AppointmentNotFoundError();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({ where: { id: appointmentId }, data: { status: "no_show" } });
    await tx.auditLog.create({
      data: {
        companyId,
        action: "appointment_no_show",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: JSON.stringify({ leadId: appointment.leadId }),
      },
    });
    return updated;
  });
}
