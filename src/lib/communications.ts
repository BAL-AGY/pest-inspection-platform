/**
 * Communications provider abstraction. No live email/SMS vendor is wired
 * up (see docs/ARCHITECTURE.md) — the "dev" provider logs to console so the
 * send path is real and testable. Swapping in a live provider later means
 * implementing `CommunicationProvider` and changing `getProvider()`; call
 * sites never change.
 *
 * Every send goes through `canSend`, which enforces consent/opt-out state.
 * This is the one gate all confirmation/reminder/follow-up sends must pass
 * through — do not send around it.
 */

export type MessageChannel = "email" | "sms";

export interface OutboundMessage {
  channel: MessageChannel;
  to: string;
  subject?: string; // email only
  body: string;
}

export interface ConsentState {
  emailConsent: boolean;
  smsConsent: boolean;
  optedOutAt: Date | null;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  /**
   * Set by a real provider once it accepts a message, to correlate a
   * later delivery-status webhook. The dev provider never sets this — it
   * has nothing real to report — see src/lib/communication-log.ts.
   */
  providerMessageId?: string;
}

export function canSend(channel: MessageChannel, consent: ConsentState): SendResult {
  if (consent.optedOutAt) {
    return { sent: false, reason: "recipient has opted out" };
  }
  if (channel === "email" && !consent.emailConsent) {
    return { sent: false, reason: "no email consent on file" };
  }
  if (channel === "sms" && !consent.smsConsent) {
    return { sent: false, reason: "no SMS consent on file" };
  }
  return { sent: true };
}

export interface CommunicationProvider {
  send(message: OutboundMessage): Promise<SendResult>;
}

class ConsoleDevProvider implements CommunicationProvider {
  async send(message: OutboundMessage): Promise<SendResult> {
    console.log(
      `[dev-communications] ${message.channel.toUpperCase()} -> ${message.to}${
        message.subject ? ` | ${message.subject}` : ""
      }\n${message.body}`,
    );
    return { sent: true };
  }
}

let provider: CommunicationProvider = new ConsoleDevProvider();

export function getProvider(): CommunicationProvider {
  return provider;
}

/** Test/DI hook — never called from application code. */
export function setProvider(p: CommunicationProvider) {
  provider = p;
}

/**
 * Consent-gated send: checks `canSend` before invoking the provider so no
 * call site can accidentally bypass consent/opt-out state.
 */
export async function sendIfConsented(
  message: OutboundMessage,
  consent: ConsentState,
): Promise<SendResult> {
  const gate = canSend(message.channel, consent);
  if (!gate.sent) return gate;
  return getProvider().send(message);
}

export const MESSAGE_TEMPLATES = {
  appointmentConfirmation: (params: { name: string; when: string }) =>
    `Hi ${params.name}, your free home pest inspection is confirmed for ${params.when}. Reply STOP to opt out.`,
  appointmentReminder: (params: { name: string; when: string }) =>
    `Reminder: your free home pest inspection is scheduled for ${params.when}. Reply STOP to opt out.`,
  rescheduled: (params: { name: string; when: string }) =>
    `Hi ${params.name}, your inspection has been moved to ${params.when}. Reply STOP to opt out.`,
  cancelled: (params: { name: string }) =>
    `Hi ${params.name}, your inspection has been cancelled. Reply if you'd like to rebook. Reply STOP to opt out.`,
  qualifiedNotBookedFollowUp: (params: { name: string }) =>
    `Hi ${params.name}, you're eligible for a free home pest inspection — want to grab a time? Reply STOP to opt out.`,
};
