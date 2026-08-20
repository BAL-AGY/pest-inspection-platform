/**
 * Persistent operational record of every communication *attempt* — not
 * proof of delivery. Closes the gap described in docs/GOAL_AUDIT.md /
 * docs/DATA_MODEL.md: `sendIfAllowed` (src/lib/suppression.ts) previously
 * had a real, consent/suppression-gated send path but nothing was ever
 * written to the database, so there was no queryable record of what was
 * actually attempted, blocked, or failed.
 *
 * A successful call into this module records that the application
 * *attempted* a send and, if it reached the provider, whether the provider
 * *accepted* it (`status: "sent"`) — never that the homeowner actually
 * received it. `"delivered"`/`"bounced"`/`"undeliverable"` exist in
 * `COMMUNICATION_STATUSES` for a future provider-webhook integration to
 * write; nothing in this codebase writes them today.
 *
 * Called exclusively from `sendIfAllowed` (the shared send gate) so no
 * call site can independently duplicate logging logic.
 */

import { prisma } from "./prisma";
import type { MessageChannel } from "./communications";
import type { CommunicationType, CommunicationStatus } from "./pipeline";

export interface LogCommunicationInput {
  companyId: string;
  leadId: string;
  appointmentId?: string | null;
  channel: MessageChannel;
  type: CommunicationType;
  to: string;
  subject?: string | null;
  status: CommunicationStatus;
  blockedReason?: string | null;
  failureReason?: string | null;
  providerMessageId?: string | null;
}

/**
 * Persists one delivery-attempt record. Failures writing the log are
 * swallowed (and reported to console) rather than propagated — a logging
 * outage must never block a real booking/reschedule/cancellation flow,
 * which is the actual business-critical action here.
 */
export async function logCommunication(input: LogCommunicationInput): Promise<void> {
  try {
    await prisma.communication.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        appointmentId: input.appointmentId ?? null,
        channel: input.channel,
        type: input.type,
        to: input.to,
        subject: input.subject ?? null,
        status: input.status,
        blockedReason: input.blockedReason ?? null,
        failureReason: input.failureReason ?? null,
        providerMessageId: input.providerMessageId ?? null,
      },
    });
  } catch (err) {
    console.error("[communication-log] failed to persist communication record", err);
  }
}
