import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Attribution } from "./attribution";
import type { FunnelEventType } from "./pipeline";

type AnalyticsDb = Pick<typeof prisma, "funnelEvent" | "visitorAttribution">;

export interface EventAttribution {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  landingPage?: string | null;
  clickId?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  referrer?: string | null;
}

export async function recordAttributionTouch(input: {
  companyId: string;
  visitorId: string;
  isDemo: boolean;
  attribution: Attribution;
  touchedAt?: Date;
}) {
  const touchedAt = input.touchedAt ?? new Date();
  const values = {
    Source: input.attribution.source,
    Medium: input.attribution.medium,
    Campaign: input.attribution.campaign,
    Content: input.attribution.content,
    Term: input.attribution.term,
    LandingPage: input.attribution.landingPage,
    Gclid: input.attribution.gclid,
    Fbclid: input.attribution.fbclid,
    Referrer: input.attribution.referrer,
  };
  const isMeaningfulTouch = Boolean(
    input.attribution.campaign || input.attribution.clickId || input.attribution.gclid ||
    input.attribution.fbclid || (input.attribution.medium && !["none", "internal"].includes(input.attribution.medium)),
  );
  const where = { companyId_visitorId: { companyId: input.companyId, visitorId: input.visitorId } };
  const update = isMeaningfulTouch ? {
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`last${key}`, value])), lastTouchedAt: touchedAt,
  } : {};
  try {
    return await prisma.visitorAttribution.upsert({
      where,
      create: {
        companyId: input.companyId, visitorId: input.visitorId, isDemo: input.isDemo,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`first${key}`, value])), firstTouchedAt: touchedAt,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`last${key}`, value])), lastTouchedAt: touchedAt,
      } as Prisma.VisitorAttributionUncheckedCreateInput,
      update,
    });
  } catch (error) {
    // Prisma can emulate upsert as read/create for this shape. Two app
    // instances observing a brand-new visitor may then race on the unique
    // company/visitor key. The winner established first touch; the loser
    // safely applies only the normal last-touch update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.visitorAttribution.update({ where, data: update });
    }
    throw error;
  }
}

export function attributionFromLead(lead: EventAttribution & {
  lastSource?: string | null;
  lastMedium?: string | null;
  lastCampaign?: string | null;
  lastContent?: string | null;
  lastTerm?: string | null;
  lastLandingPage?: string | null;
  lastGclid?: string | null;
  lastFbclid?: string | null;
  lastReferrer?: string | null;
}): EventAttribution {
  return {
    source: lead.lastSource ?? lead.source,
    medium: lead.lastMedium ?? lead.medium,
    campaign: lead.lastCampaign ?? lead.campaign,
    content: lead.lastContent ?? lead.content,
    term: lead.lastTerm ?? lead.term,
    landingPage: lead.lastLandingPage ?? lead.landingPage,
    clickId: lead.clickId,
    gclid: lead.lastGclid ?? lead.gclid,
    fbclid: lead.lastFbclid ?? lead.fbclid,
    referrer: lead.lastReferrer ?? lead.referrer,
  };
}

export async function recordFunnelEvent(input: {
  companyId: string;
  visitorId: string;
  eventType: FunnelEventType;
  eventKey: string;
  isDemo: boolean;
  leadId?: string | null;
  appointmentId?: string | null;
  funnelStep?: string | null;
  attribution?: EventAttribution;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt?: Date;
}, db: AnalyticsDb = prisma) {
  await db.funnelEvent.createMany({
      data: [{
        companyId: input.companyId,
        visitorId: input.visitorId,
        leadId: input.leadId ?? null,
        appointmentId: input.appointmentId ?? null,
        eventType: input.eventType,
        eventKey: input.eventKey,
        funnelStep: input.funnelStep ?? null,
        isDemo: input.isDemo,
        source: input.attribution?.source ?? null,
        medium: input.attribution?.medium ?? null,
        campaign: input.attribution?.campaign ?? null,
        content: input.attribution?.content ?? null,
        term: input.attribution?.term ?? null,
        landingPage: input.attribution?.landingPage ?? null,
        clickId: input.attribution?.clickId ?? null,
        gclid: input.attribution?.gclid ?? null,
        fbclid: input.attribution?.fbclid ?? null,
        referrer: input.attribution?.referrer ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: input.createdAt,
      }],
      skipDuplicates: true,
    });
  return db.funnelEvent.findUnique({
    where: { companyId_eventKey: { companyId: input.companyId, eventKey: input.eventKey } },
  });
}

export function answerEventKey(leadId: string, questionId: string, value: unknown) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  return `lead:${leadId}:question:${questionId}:${digest}`;
}

/** Customer outcome is current-state data: switching won/lost replaces the prior state. */
export async function recordCustomerOutcomeEvent(input: {
  companyId: string; leadId: string; visitorId: string; outcome: "won" | "lost";
  isDemo: boolean; attribution?: EventAttribution;
}) {
  const eventKey = `lead:${input.leadId}:outcome`;
  const data = {
    visitorId: input.visitorId,
    leadId: input.leadId,
    eventType: input.outcome === "won" ? "customer_won" : "customer_lost",
    funnelStep: "outcome",
    isDemo: input.isDemo,
    source: input.attribution?.source ?? null,
    medium: input.attribution?.medium ?? null,
    campaign: input.attribution?.campaign ?? null,
    content: input.attribution?.content ?? null,
    term: input.attribution?.term ?? null,
    landingPage: input.attribution?.landingPage ?? null,
    clickId: input.attribution?.clickId ?? null,
    gclid: input.attribution?.gclid ?? null,
    fbclid: input.attribution?.fbclid ?? null,
    referrer: input.attribution?.referrer ?? null,
    createdAt: new Date(),
  };
  const where = { companyId_eventKey: { companyId: input.companyId, eventKey } };
  try {
    return await prisma.funnelEvent.upsert({ where, create: { companyId: input.companyId, eventKey, ...data }, update: data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.funnelEvent.update({ where, data });
    }
    throw error;
  }
}

/** Revenue is current-state data: one event per lead is updated, never summed twice. */
export async function recordRevenueEvent(input: {
  companyId: string; leadId: string; visitorId: string; amountCents: number;
  isDemo: boolean; attribution?: EventAttribution;
}) {
  const eventKey = `lead:${input.leadId}:revenue`;
  const data = {
    visitorId: input.visitorId,
    leadId: input.leadId,
    eventType: "revenue_recorded",
    funnelStep: "revenue",
    isDemo: input.isDemo,
    source: input.attribution?.source ?? null,
    medium: input.attribution?.medium ?? null,
    campaign: input.attribution?.campaign ?? null,
    content: input.attribution?.content ?? null,
    term: input.attribution?.term ?? null,
    landingPage: input.attribution?.landingPage ?? null,
    clickId: input.attribution?.clickId ?? null,
    gclid: input.attribution?.gclid ?? null,
    fbclid: input.attribution?.fbclid ?? null,
    referrer: input.attribution?.referrer ?? null,
    metadata: JSON.stringify({ amountCents: input.amountCents }),
    createdAt: new Date(),
  };
  const where = { companyId_eventKey: { companyId: input.companyId, eventKey } };
  try {
    return await prisma.funnelEvent.upsert({ where, create: { companyId: input.companyId, eventKey, ...data }, update: data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.funnelEvent.update({ where, data });
    }
    throw error;
  }
}

/** A lost outcome invalidates the current attributed revenue without deleting its audit row. */
export async function clearRevenueEvent(companyId: string, leadId: string) {
  return prisma.funnelEvent.updateMany({
    where: { companyId, eventKey: `lead:${leadId}:revenue` },
    data: { eventType: "revenue_removed", metadata: JSON.stringify({ amountCents: 0 }), createdAt: new Date() },
  });
}
