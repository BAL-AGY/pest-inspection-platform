import { prisma } from "./prisma";
import { MESSAGE_TEMPLATES } from "./communications";
import { sendIfAllowed } from "./suppression";

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

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  const otherActive = await prisma.appointment.count({
    where: {
      leadId: appointment.leadId,
      status: { in: ["booked", "rescheduled"] },
      id: { not: appointmentId },
    },
  });
  if (otherActive === 0) {
    await prisma.lead.update({
      where: { id: appointment.leadId },
      data: {
        status: appointment.lead.classification === "sql" ? "sql" : appointment.lead.status,
      },
    });
  }

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
