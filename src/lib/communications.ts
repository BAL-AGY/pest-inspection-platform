import crypto from "crypto";

export type MessageChannel = "email" | "sms";
export type CommunicationPurpose = "transactional" | "marketing";
export type CommunicationDirection = "outbound" | "inbound";

export interface OutboundMessage {
  channel: MessageChannel;
  to: string;
  subject?: string; // email only
  body: string;
}

export interface ConsentState {
  emailConsent: boolean;
  smsConsent: boolean;
  emailMarketingConsent?: boolean;
  smsMarketingConsent?: boolean;
  emailOptedOutAt?: Date | null;
  smsOptedOutAt?: Date | null;
  optedOutAt: Date | null;
}

export interface SendResult {
  accepted: boolean;
  reason?: string;
  providerMessageId?: string;
}

export function canSend(
  channel: MessageChannel,
  purpose: CommunicationPurpose,
  consent: ConsentState,
): SendResult {
  if (consent.optedOutAt) return { accepted: false, reason: "recipient has opted out" };
  if (channel === "email" && consent.emailOptedOutAt) {
    return { accepted: false, reason: "recipient opted out of email" };
  }
  if (channel === "sms" && consent.smsOptedOutAt) {
    return { accepted: false, reason: "recipient opted out of SMS" };
  }
  if (channel === "email" && !consent.emailConsent) {
    return { accepted: false, reason: `no email consent on file for ${purpose} communication` };
  }
  if (channel === "sms" && !consent.smsConsent) {
    return { accepted: false, reason: `no SMS consent on file for ${purpose} communication` };
  }
  if (purpose === "marketing" && channel === "email" && !consent.emailMarketingConsent) {
    return { accepted: false, reason: "no email marketing consent on file" };
  }
  if (purpose === "marketing" && channel === "sms" && !consent.smsMarketingConsent) {
    return { accepted: false, reason: "no SMS marketing consent on file" };
  }
  return { accepted: true };
}

export interface ProviderSendInput {
  message: OutboundMessage;
  idempotencyKey: string;
}

export interface CommunicationProvider {
  readonly name: string;
  send(input: ProviderSendInput): Promise<SendResult>;
}

class DisabledProvider implements CommunicationProvider {
  readonly name = "disabled";
  async send(): Promise<SendResult> {
    return { accepted: false, reason: "No live communication provider is configured" };
  }
}

/** Non-network adapter for development/tests. It never logs recipient content. */
export class DeterministicCommunicationProvider implements CommunicationProvider {
  readonly name = "deterministic";
  async send(input: ProviderSendInput): Promise<SendResult> {
    return {
      accepted: true,
      providerMessageId: `det_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`,
    };
  }
}

let providerOverride: CommunicationProvider | null = null;

export function getProvider(): CommunicationProvider {
  if (providerOverride) return providerOverride;
  return process.env.COMMUNICATION_PROVIDER === "deterministic" || process.env.NODE_ENV !== "production"
    ? new DeterministicCommunicationProvider()
    : new DisabledProvider();
}

/** Test-only dependency injection hook. */
export function setProvider(provider: CommunicationProvider | null) {
  providerOverride = provider;
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
