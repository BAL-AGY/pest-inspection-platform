import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { normalizeEmail, normalizePhone } from "./suppression";
import type { MessageChannel } from "./communications";
import { isStagingEnvironment } from "./environment";

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

const verifiedEventSchema = z.object({
  id: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200),
  type: z.enum(["delivered", "failed", "bounced", "inbound_message", "opted_out"]),
  channel: z.enum(["email", "sms"]),
  occurredAt: z.string().datetime(),
  messageId: z.string().min(1).max(300).optional(),
  from: z.string().min(1).max(320).optional(),
  to: z.string().min(1).max(320).optional(),
  body: z.string().max(10_000).optional(),
  reason: z.string().max(500).optional(),
  optOutScope: z.enum(["marketing", "all"]).optional(),
}).superRefine((event, ctx) => {
  if (["delivered", "failed", "bounced"].includes(event.type) && !event.messageId) {
    ctx.addIssue({ code: "custom", message: "messageId is required for delivery events" });
  }
  if (["inbound_message", "opted_out"].includes(event.type) && !event.from) {
    ctx.addIssue({ code: "custom", message: "from is required for inbound events" });
  }
});

export type VerifiedCommunicationEvent = z.infer<typeof verifiedEventSchema>;

export interface CommunicationWebhookAdapter {
  readonly name: string;
  verify(input: { rawBody: string; headers: Headers; now?: Date }): VerifiedCommunicationEvent | null;
}

/**
 * Deterministic HMAC adapter for local integration tests only. Live vendors
 * must implement this interface using their own documented signature scheme.
 */
export class DeterministicWebhookAdapter implements CommunicationWebhookAdapter {
  readonly name = "deterministic";
  constructor(private readonly secret: string) {}

  verify(input: { rawBody: string; headers: Headers; now?: Date }): VerifiedCommunicationEvent | null {
    const timestamp = input.headers.get("x-communication-timestamp");
    const signature = input.headers.get("x-communication-signature");
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return null;
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const timestampSeconds = Number(timestamp);
    if (Math.abs(nowSeconds - timestampSeconds) > MAX_WEBHOOK_AGE_SECONDS) return null;

    const expected = crypto.createHmac("sha256", this.secret).update(`${timestamp}.${input.rawBody}`).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    const actualBytes = /^[a-f\d]{64}$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.alloc(0);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
      return null;
    }
    const parsedJson = (() => { try { return JSON.parse(input.rawBody) as unknown; } catch { return null; } })();
    const parsed = verifiedEventSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  }
}

let adapterOverrides = new Map<string, CommunicationWebhookAdapter>();

export function setCommunicationWebhookAdapter(adapter: CommunicationWebhookAdapter | null) {
  adapterOverrides = new Map(adapter ? [[adapter.name, adapter]] : []);
}

export function getCommunicationWebhookAdapter(name: string): CommunicationWebhookAdapter | null {
  const overridden = adapterOverrides.get(name);
  if (overridden) return overridden;
  const secret = process.env.COMMUNICATION_TEST_WEBHOOK_SECRET;
  if (
    name === "deterministic" &&
    (
      process.env.NODE_ENV !== "production" ||
      (isStagingEnvironment() && process.env.COMMUNICATION_PROVIDER === "deterministic")
    ) &&
    secret
  ) {
    return new DeterministicWebhookAdapter(secret);
  }
  return null;
}

function normalizedInbound(channel: MessageChannel, value: string): string {
  return channel === "email" ? normalizeEmail(value) : normalizePhone(value);
}

function isStop(event: VerifiedCommunicationEvent): boolean {
  return event.type === "opted_out" ||
    (event.channel === "sms" && STOP_WORDS.has((event.body ?? "").trim().toUpperCase()));
}

export async function processVerifiedCommunicationEvent(
  provider: string,
  event: VerifiedCommunicationEvent,
  rawBody: string,
): Promise<{ outcome: string; duplicate: boolean }> {
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${event.id}`}))`;
    const prior = await tx.communicationWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider, providerEventId: event.id } },
    });
    if (prior?.processedAt) return { outcome: prior.outcome, duplicate: true };

    const account = await tx.communicationProviderAccount.findUnique({
      where: { provider_externalAccountId: { provider, externalAccountId: event.accountId } },
    });
    if (!account?.active || account.channel !== event.channel) {
      // An authenticated provider event still cannot select a tenant unless
      // its provider account has an authoritative server-side mapping.
      return { outcome: "unknown_account", duplicate: false };
    }

    const webhook = prior ?? await tx.communicationWebhookEvent.create({
      data: {
        companyId: account.companyId,
        providerAccountId: account.id,
        provider,
        providerEventId: event.id,
        eventType: event.type,
        payloadHash,
        outcome: "processing",
        occurredAt: new Date(event.occurredAt),
      },
    });

    let communicationId: string | null = null;
    let leadId: string | null = null;
    let outcome = "ignored";
    const occurredAt = new Date(event.occurredAt);

    if (["delivered", "failed", "bounced"].includes(event.type) && event.messageId) {
      const communication = await tx.communication.findFirst({
        where: { companyId: account.companyId, provider, providerMessageId: event.messageId },
      });
      if (!communication || communication.providerAccountId !== account.id) {
        outcome = "wrong_company_or_message";
      } else if (communication.providerStatusAt && communication.providerStatusAt > occurredAt) {
        communicationId = communication.id;
        leadId = communication.leadId;
        outcome = "stale_event";
      } else {
        communicationId = communication.id;
        leadId = communication.leadId;
        const status = event.type === "delivered" ? "delivered" : event.type === "bounced" ? "bounced" : "failed";
        await tx.communication.update({
          where: { id: communication.id },
          data: {
            status,
            providerStatusAt: occurredAt,
            deliveredAt: status === "delivered" ? occurredAt : communication.deliveredAt,
            bouncedAt: status === "bounced" ? occurredAt : communication.bouncedAt,
            failedAt: status === "failed" ? occurredAt : communication.failedAt,
            failureReason: status === "delivered" ? null : (event.reason ?? `Provider reported ${status}`),
          },
        });
        outcome = status;
      }
    } else if (event.from) {
      const normalized = normalizedInbound(event.channel, event.from);
      const lead = await tx.lead.findFirst({
        where: event.channel === "email"
          ? { companyId: account.companyId, normalizedEmail: normalized }
          : { companyId: account.companyId, normalizedPhone: normalized },
        orderBy: { updatedAt: "desc" },
      });
      if (!lead) {
        outcome = "unmatched_sender";
      } else {
        leadId = lead.id;
        const stopped = isStop(event);
        const inbound = await tx.communication.create({
          data: {
            companyId: account.companyId,
            leadId: lead.id,
            providerAccountId: account.id,
            channel: event.channel,
            type: stopped ? "inbound_opt_out" : "inbound_reply",
            direction: "inbound",
            purpose: "transactional",
            provider,
            dedupeKey: `webhook:${provider}:${event.id}`,
            status: stopped ? "opted_out" : "received",
            to: event.to ?? account.address ?? event.accountId,
            from: event.from,
            body: event.body ?? null,
            providerMessageId: event.messageId ?? null,
            receivedAt: occurredAt,
            providerStatusAt: occurredAt,
          },
        });
        communicationId = inbound.id;
        outcome = stopped ? "opted_out" : "received";

        if (stopped) {
          const scope = event.channel === "sms" ? "all" : (event.optOutScope ?? "marketing");
          const identifierType = event.channel === "email" ? "email" : "phone";
          await tx.suppressionEntry.upsert({
            where: {
              companyId_channel_identifierType_identifierValue: {
                companyId: account.companyId,
                channel: event.channel,
                identifierType,
                identifierValue: normalized,
              },
            },
            create: {
              companyId: account.companyId,
              channel: event.channel,
              scope,
              identifierType,
              identifierValue: normalized,
              reason: "provider_opt_out",
              source: `${provider}_webhook`,
              metadata: JSON.stringify({ providerEventId: event.id }),
            },
            update: scope === "all" ? { scope: "all" } : {},
          });
          await tx.lead.updateMany({
            where: event.channel === "email"
              ? { companyId: account.companyId, normalizedEmail: normalized }
              : { companyId: account.companyId, normalizedPhone: normalized },
            data: event.channel === "email"
              ? {
                  emailConsent: scope === "all" ? false : undefined,
                  emailMarketingConsent: false,
                  emailOptedOutAt: scope === "all" ? occurredAt : undefined,
                }
              : { smsConsent: false, smsMarketingConsent: false, smsOptedOutAt: occurredAt },
          });
        }
      }
    }

    if (leadId) {
      const eventType = outcome === "delivered"
        ? "communication_delivered"
        : outcome === "bounced"
          ? "communication_bounced"
          : outcome === "failed"
            ? "communication_failed"
            : outcome === "opted_out"
              ? "communication_opted_out"
              : "communication_inbound";
      await tx.funnelEvent.create({
        data: {
          companyId: account.companyId,
          leadId,
          visitorId: leadId,
          eventType,
          metadata: JSON.stringify({ communicationId, providerEventId: event.id, channel: event.channel }),
        },
      });
    }

    await tx.communicationWebhookEvent.update({
      where: { id: webhook.id },
      data: { communicationId, outcome, processedAt: new Date() },
    });
    return { outcome, duplicate: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
