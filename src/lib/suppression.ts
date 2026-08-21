/**
 * Durable, cross-lead/cross-session suppression. Closes the gap described
 * in docs/GOAL_AUDIT.md and docs/DATA_MODEL.md: `Lead.optedOutAt` only
 * protects the one Lead row it lives on, so a person who opts out and later
 * re-enters the funnel under a new `visitorId` (a new anonymous session,
 * which becomes a new `Lead`) would not otherwise be suppressed.
 *
 * `SuppressionEntry` is keyed by (companyId, channel, normalized identifier)
 * and is checked independently of any single Lead's consent fields.
 * `sendIfAllowed` is the shared gate: it wraps `communications.canSend`
 * (per-lead consent/opt-out) with a suppression-table check and persists
 * an operational delivery record via `communication-log.ts` for every
 * attempt. It is what every send call site should use instead of calling
 * `communications.sendIfConsented` directly, so a new call site can't
 * accidentally bypass suppression or delivery logging.
 */

import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import {
  canSend,
  getProvider,
  type ConsentState,
  type CommunicationPurpose,
  type MessageChannel,
  type OutboundMessage,
  type SendResult,
} from "./communications";
import type { CommunicationType } from "./pipeline";

/**
 * Normalizes an email for comparison: trims whitespace and lowercases.
 * Deliberately does NOT strip "+tag" addressing or dots (e.g. Gmail's
 * `user+tag@`/`u.ser@` aliasing) — those can be genuinely distinct mailboxes
 * on non-Gmail providers, and merging them risks suppressing an address the
 * contact never opted out with.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalizes a phone number to bare digits for comparison, stripping a
 * leading US/Canada country code (`1`) when present so `+1 (555) 555-0100`,
 * `15555550100`, and `555-555-0100` all match. Numbers that don't look like
 * an 11-digit NANP number are normalized to digits-only without guessing at
 * international country codes, to avoid merging genuinely distinct numbers.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export type SuppressionChannel = MessageChannel | "all";

interface ContactIdentifiers {
  email?: string | null;
  phone?: string | null;
}

function identifierRows(contact: ContactIdentifiers): { identifierType: "email" | "phone"; identifierValue: string }[] {
  const rows: { identifierType: "email" | "phone"; identifierValue: string }[] = [];
  if (contact.email) rows.push({ identifierType: "email", identifierValue: normalizeEmail(contact.email) });
  if (contact.phone) rows.push({ identifierType: "phone", identifierValue: normalizePhone(contact.phone) });
  return rows;
}

/**
 * True if the given channel is suppressed for this contact within this
 * company (checks channel-specific entries and blanket "all" entries).
 * Tenant-scoped: a suppression entry for one company never matches another.
 */
export async function isSuppressed(params: {
  companyId: string;
  channel: MessageChannel;
  email?: string | null;
  phone?: string | null;
  purpose?: CommunicationPurpose;
}): Promise<boolean> {
  const rows = identifierRows(params);
  if (rows.length === 0) return false;

  const count = await prisma.suppressionEntry.count({
    where: {
      companyId: params.companyId,
      channel: { in: [params.channel, "all"] },
      scope: { in: params.purpose === "marketing" ? ["all", "marketing"] : ["all"] },
      OR: rows.map((r) => ({ identifierType: r.identifierType, identifierValue: r.identifierValue })),
    },
  });
  return count > 0;
}

/**
 * Returns which channels ("email"/"sms") are currently suppressed for this
 * contact, for surfacing suppression status at lead-capture time (not just
 * at send time).
 */
export async function suppressedChannels(params: {
  companyId: string;
  email?: string | null;
  phone?: string | null;
}): Promise<{ email: boolean; sms: boolean; emailMarketing: boolean; smsMarketing: boolean }> {
  const [email, sms, emailMarketing, smsMarketing] = await Promise.all([
    params.email
      ? isSuppressed({ companyId: params.companyId, channel: "email", email: params.email })
      : Promise.resolve(false),
    params.phone
      ? isSuppressed({ companyId: params.companyId, channel: "sms", phone: params.phone })
      : Promise.resolve(false),
    params.email
      ? isSuppressed({ companyId: params.companyId, channel: "email", email: params.email, purpose: "marketing" })
      : Promise.resolve(false),
    params.phone
      ? isSuppressed({ companyId: params.companyId, channel: "sms", phone: params.phone, purpose: "marketing" })
      : Promise.resolve(false),
  ]);
  return { email, sms, emailMarketing, smsMarketing };
}

/**
 * Persists a suppression entry for every identifier present on the contact.
 * Idempotent (upsert on the (companyId, channel, identifierType,
 * identifierValue) unique key) — re-suppressing an already-suppressed
 * contact doesn't overwrite the original reason/source/createdAt.
 */
export async function recordSuppression(params: {
  companyId: string;
  channel: SuppressionChannel;
  email?: string | null;
  phone?: string | null;
  reason: string;
  source: string;
  metadata?: Record<string, unknown>;
  scope?: "marketing" | "all";
}): Promise<void> {
  const rows = identifierRows(params);
  for (const row of rows) {
    await prisma.suppressionEntry.upsert({
      where: {
        companyId_channel_identifierType_identifierValue: {
          companyId: params.companyId,
          channel: params.channel,
          identifierType: row.identifierType,
          identifierValue: row.identifierValue,
        },
      },
      create: {
        companyId: params.companyId,
        channel: params.channel,
        scope: params.scope ?? "all",
        identifierType: row.identifierType,
        identifierValue: row.identifierValue,
        reason: params.reason,
        source: params.source,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
      update: params.scope === "all" || !params.scope ? { scope: "all" } : {},
    });
  }
}

/**
 * The shared send gate. Checks the durable suppression table *before*
 * falling through to `communications.canSend`'s per-lead consent/opt-out
 * check, then persists an operational record of what happened via
 * `logCommunication` (src/lib/communication-log.ts) — every outbound send
 * call site should use this instead of calling `sendIfConsented` directly,
 * so suppression and delivery logging can never be bypassed by a new call
 * site duplicating the logic itself.
 *
 * `accepted: true` means the provider accepted the message, not that the
 * homeowner received it — see communication-log.ts.
 *
 * Note: like the existing `canSend`, this does not distinguish marketing
 * from transactional/operational messages — the current system has no such
 * distinction (every send, including booking confirmations and reschedule/
 * cancellation notices, is gated the same way), so suppression blocks all
 * of them uniformly. See docs/ARCHITECTURE.md for the documented
 * limitation and what would be required to split the two.
 */
export async function sendIfAllowed(
  message: OutboundMessage,
  params: {
    companyId: string;
    leadId: string;
    appointmentId?: string | null;
        type: CommunicationType;
    purpose: CommunicationPurpose;
    dedupeKey: string;
    consent: ConsentState;
  },
): Promise<SendResult & { duplicate?: boolean; communicationId?: string }> {
  const provider = getProvider();
  const providerAccount = await prisma.communicationProviderAccount.findFirst({
    where: {
      companyId: params.companyId,
      provider: provider.name,
      channel: message.channel,
      active: true,
    },
  });
  const logBase = {
    companyId: params.companyId,
    leadId: params.leadId,
    appointmentId: params.appointmentId,
    channel: message.channel,
    type: params.type,
    to: message.to,
    subject: message.subject,
    purpose: params.purpose,
    direction: "outbound",
    provider: provider.name,
    dedupeKey: params.dedupeKey,
    providerAccountId: providerAccount?.id ?? null,
  };

  const createRecord = async (status: string, extra: Record<string, unknown> = {}) => {
    try {
      return await prisma.communication.create({ data: { ...logBase, status, ...extra } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return prisma.communication.findUnique({
          where: { companyId_dedupeKey: { companyId: params.companyId, dedupeKey: params.dedupeKey } },
        });
      }
      throw error;
    }
  };

  const suppressed = await isSuppressed({
    companyId: params.companyId,
    channel: message.channel,
    email: message.channel === "email" ? message.to : undefined,
    phone: message.channel === "sms" ? message.to : undefined,
    purpose: params.purpose,
  });
  if (suppressed) {
    const row = await createRecord("suppressed", { blockedReason: "recipient is suppressed" });
    return { accepted: false, reason: "recipient is suppressed", communicationId: row?.id };
  }

  const gate = canSend(message.channel, params.purpose, params.consent);
  if (!gate.accepted) {
    const row = await createRecord("blocked", { blockedReason: gate.reason });
    return { ...gate, communicationId: row?.id };
  }

  let attempt;
  try {
    const inserted = await prisma.communication.createMany({
      data: [{ ...logBase, status: "attempted" }],
      skipDuplicates: true,
    });
    attempt = await prisma.communication.findUniqueOrThrow({
      where: { companyId_dedupeKey: { companyId: params.companyId, dedupeKey: params.dedupeKey } },
    });
    if (inserted.count === 0) {
      return {
        accepted: attempt.status === "accepted" || attempt.status === "delivered",
        reason: "duplicate communication suppressed",
        duplicate: true,
        communicationId: attempt.id,
        providerMessageId: attempt.providerMessageId ?? undefined,
      };
    }
  } catch {
    // No durable attempt record means no provider call. This is deliberate:
    // accurate/idempotent communication is more important than best-effort send.
    return { accepted: false, reason: "communication persistence unavailable" };
  }

  await prisma.funnelEvent.create({
    data: {
      companyId: params.companyId,
      leadId: params.leadId,
      visitorId: params.leadId,
      eventType: "communication_attempted",
      metadata: JSON.stringify({ communicationId: attempt.id, channel: message.channel, purpose: params.purpose }),
    },
  });

  try {
    const result = await provider.send({ message, idempotencyKey: params.dedupeKey });
    const status = result.accepted ? "accepted" : "failed";
    await prisma.communication.update({
      where: { id: attempt.id },
      data: {
        status,
        acceptedAt: result.accepted ? new Date() : null,
        failedAt: result.accepted ? null : new Date(),
        failureReason: result.accepted ? null : (result.reason ?? "Provider declined to send"),
        providerMessageId: result.providerMessageId ?? null,
      },
    });
    await prisma.funnelEvent.create({
      data: {
        companyId: params.companyId,
        leadId: params.leadId,
        visitorId: params.leadId,
        eventType: result.accepted ? "communication_accepted" : "communication_failed",
        metadata: JSON.stringify({ communicationId: attempt.id, channel: message.channel, purpose: params.purpose }),
      },
    });
    return { ...result, communicationId: attempt.id };
  } catch {
    await prisma.communication.update({
      where: { id: attempt.id },
      data: { status: "failed", failedAt: new Date(), failureReason: "Provider request failed" },
    });
    await prisma.funnelEvent.create({
      data: {
        companyId: params.companyId,
        leadId: params.leadId,
        visitorId: params.leadId,
        eventType: "communication_failed",
        metadata: JSON.stringify({ communicationId: attempt.id, channel: message.channel, purpose: params.purpose }),
      },
    });
    return { accepted: false, reason: "provider error", communicationId: attempt.id };
  }
}
