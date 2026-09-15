import type { Appointment, Company, Lead } from "@prisma/client";
import type { CommunicationProvider, ProviderSendInput, SendResult } from "./communications";
import { sendIfAllowed } from "./suppression";

const phonePattern = /^\+[1-9]\d{7,14}$/;

// Selected only for owner alerts: configuring this never enables customer SMS.
export class OwnerAlertTwilioProvider implements CommunicationProvider {
  readonly name = "twilio";

  constructor(private readonly config: { sid: string; token: string; from: string }) {}

  async send({ message }: ProviderSendInput): Promise<SendResult> {
    if (message.channel !== "sms") return { accepted: false, reason: "SMS only" };
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.sid}:${this.config.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: message.to, From: this.config.from, Body: message.body }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    // Never put provider response text in logs: it can contain phone numbers.
    if (!response.ok) return { accepted: false, reason: `Twilio HTTP ${response.status}` };
    const payload = await response.json() as { sid?: string };
    if (!payload.sid) return { accepted: false, reason: "Twilio returned no message ID" };
    return { accepted: true, providerMessageId: payload.sid };
  }
}

export async function sendOwnerBookingAlert({ appointment, company, lead }: {
  appointment: Pick<Appointment, "id" | "scheduledStart" | "isDemo">;
  company: Pick<Company, "id" | "slug" | "timezone">;
  lead: Pick<Lead, "id" | "firstName" | "lastName">;
}): Promise<void> {
  if (process.env.OWNER_BOOKING_SMS_ENABLED !== "true") return;
  if (company.slug !== process.env.OWNER_BOOKING_SMS_COMPANY_SLUG) return;
  if (appointment.isDemo && process.env.OWNER_BOOKING_SMS_INCLUDE_DEMO !== "true") return;

  try {
    const to = process.env.OWNER_BOOKING_SMS_TO?.trim() ?? "";
    const from = process.env.TWILIO_FROM_NUMBER?.trim() ?? "";
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
    const token = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
    if (!phonePattern.test(to) || !phonePattern.test(from) || !/^AC[0-9a-fA-F]{32}$/.test(sid) || !token) {
      console.error("Owner booking SMS configuration is incomplete or invalid");
      return;
    }
    const when = appointment.scheduledStart.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: company.timezone, timeZoneName: "short",
    });
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").slice(0, 80) || "New customer";
    const origin = new URL(process.env.AUTH_URL ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password) {
      throw new Error("Invalid dashboard origin");
    }
    const link = new URL(`/dashboard/leads/${encodeURIComponent(lead.id)}`, origin.origin).href;
    const result = await sendIfAllowed(
      { channel: "sms", to, body: `New inspection booked: ${name}. ${when}. ${link}` },
      {
        companyId: company.id, leadId: lead.id, appointmentId: appointment.id,
        type: "owner_booking_alert", purpose: "transactional",
        dedupeKey: `appointment:${appointment.id}:owner-booking:sms`,
        // The configured owner opted into these alerts; customer consent is unrelated.
        consent: { emailConsent: false, smsConsent: true, optedOutAt: null },
        provider: new OwnerAlertTwilioProvider({ sid, token, from }),
      },
    );
    if (!result.accepted && !result.duplicate) console.error("Owner booking SMS was not accepted", { appointmentId: appointment.id });
  } catch {
    // A notification failure must not turn a committed booking into an error.
    console.error("Owner booking SMS failed", { appointmentId: appointment.id });
  }
}
