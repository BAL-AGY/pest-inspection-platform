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
 * (per-lead consent/opt-out) with a suppression-table check and is what
 * every send call site should use instead of calling
 * `communications.sendIfConsented` directly, so a new call site can't
 * accidentally bypass suppression.
 */

import { prisma } from "./prisma";
import {
  sendIfConsented,
  type ConsentState,
  type MessageChannel,
  type OutboundMessage,
  type SendResult,
} from "./communications";

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
}): Promise<boolean> {
  const rows = identifierRows(params);
  if (rows.length === 0) return false;

  const count = await prisma.suppressionEntry.count({
    where: {
      companyId: params.companyId,
      channel: { in: [params.channel, "all"] },
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
}): Promise<{ email: boolean; sms: boolean }> {
  const [email, sms] = await Promise.all([
    params.email
      ? isSuppressed({ companyId: params.companyId, channel: "email", email: params.email })
      : Promise.resolve(false),
    params.phone
      ? isSuppressed({ companyId: params.companyId, channel: "sms", phone: params.phone })
      : Promise.resolve(false),
  ]);
  return { email, sms };
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
        identifierType: row.identifierType,
        identifierValue: row.identifierValue,
        reason: params.reason,
        source: params.source,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
      update: {},
    });
  }
}

/**
 * The shared send gate. Checks the durable suppression table *before*
 * falling through to `communications.canSend`'s per-lead consent/opt-out
 * check. Every outbound send call site should use this instead of calling
 * `sendIfConsented` directly.
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
  params: { companyId: string; consent: ConsentState },
): Promise<SendResult> {
  const suppressed = await isSuppressed({
    companyId: params.companyId,
    channel: message.channel,
    email: message.channel === "email" ? message.to : undefined,
    phone: message.channel === "sms" ? message.to : undefined,
  });
  if (suppressed) {
    return { sent: false, reason: "recipient is suppressed" };
  }
  return sendIfConsented(message, params.consent);
}
