import { prisma } from "./prisma";
import { MESSAGE_TEMPLATES } from "./communications";
import { sendIfAllowed } from "./suppression";

export async function runDueCommunicationJobs(now = new Date()) {
  const reminderStart = new Date(now.getTime() + 23 * 60 * 60_000);
  const reminderEnd = new Date(now.getTime() + 25 * 60 * 60_000);
  const followUpCutoff = new Date(now.getTime() - 15 * 60_000);

  const [appointments, leads] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        status: { in: ["booked", "rescheduled"] },
        scheduledStart: { gte: reminderStart, lt: reminderEnd },
      },
      include: { lead: true, company: true },
    }),
    prisma.lead.findMany({
      where: {
        classification: "sql",
        status: "sql",
        updatedAt: { lte: followUpCutoff },
        appointments: { none: { status: { in: ["booked", "rescheduled"] } } },
      },
    }),
  ]);

  let attempts = 0;
  for (const appointment of appointments) {
    const consent = {
      emailConsent: appointment.lead.emailConsent,
      smsConsent: appointment.lead.smsConsent,
      emailMarketingConsent: appointment.lead.emailMarketingConsent,
      smsMarketingConsent: appointment.lead.smsMarketingConsent,
      emailOptedOutAt: appointment.lead.emailOptedOutAt,
      smsOptedOutAt: appointment.lead.smsOptedOutAt,
      optedOutAt: appointment.lead.optedOutAt,
    };
    const when = appointment.scheduledStart.toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: appointment.company.timezone,
    });
    const body = MESSAGE_TEMPLATES.appointmentReminder({
      name: appointment.lead.firstName ?? "there",
      when,
    });
    if (appointment.lead.email) {
      attempts += 1;
      await sendIfAllowed(
        { channel: "email", to: appointment.lead.email, subject: "Inspection reminder", body },
        {
          companyId: appointment.companyId,
          leadId: appointment.leadId,
          appointmentId: appointment.id,
          type: "appointment_reminder",
          purpose: "transactional",
          dedupeKey: `appointment:${appointment.id}:reminder-24h:email`,
          consent,
        },
      );
    }
    if (appointment.lead.phone) {
      attempts += 1;
      await sendIfAllowed(
        { channel: "sms", to: appointment.lead.phone, body },
        {
          companyId: appointment.companyId,
          leadId: appointment.leadId,
          appointmentId: appointment.id,
          type: "appointment_reminder",
          purpose: "transactional",
          dedupeKey: `appointment:${appointment.id}:reminder-24h:sms`,
          consent,
        },
      );
    }
  }

  for (const lead of leads) {
    const consent = {
      emailConsent: lead.emailConsent,
      smsConsent: lead.smsConsent,
      emailMarketingConsent: lead.emailMarketingConsent,
      smsMarketingConsent: lead.smsMarketingConsent,
      emailOptedOutAt: lead.emailOptedOutAt,
      smsOptedOutAt: lead.smsOptedOutAt,
      optedOutAt: lead.optedOutAt,
    };
    const body = MESSAGE_TEMPLATES.qualifiedNotBookedFollowUp({ name: lead.firstName ?? "there" });
    if (lead.email) {
      attempts += 1;
      await sendIfAllowed(
        { channel: "email", to: lead.email, subject: "Book your free pest inspection", body },
        {
          companyId: lead.companyId,
          leadId: lead.id,
          type: "qualified_not_booked_follow_up",
          purpose: "marketing",
          dedupeKey: `lead:${lead.id}:qualified-follow-up:email`,
          consent,
        },
      );
    }
    if (lead.phone) {
      attempts += 1;
      await sendIfAllowed(
        { channel: "sms", to: lead.phone, body },
        {
          companyId: lead.companyId,
          leadId: lead.id,
          type: "qualified_not_booked_follow_up",
          purpose: "marketing",
          dedupeKey: `lead:${lead.id}:qualified-follow-up:sms`,
          consent,
        },
      );
    }
  }
  return { appointments: appointments.length, qualifiedLeads: leads.length, attempts };
}
