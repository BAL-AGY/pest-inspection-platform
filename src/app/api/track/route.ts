import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveCompany } from "@/lib/company";
import { parseAttribution, resolveAttribution } from "@/lib/attribution";
import { recordAttributionTouch, recordFunnelEvent } from "@/lib/analytics-events";
import {
  enforceRateLimit,
  publicCompanyRateLimitScope,
  rateLimitResponse,
  trustedClientAddress,
} from "@/lib/rate-limit";
import { verifyLeadToken } from "@/lib/funnel-capability";

const trackSchema = z.object({
  visitorId: z.string().min(1).max(200),
  eventType: z.enum(["landing_page_view", "inspection_cta_clicked", "funnel_started", "appointment_selected"]),
  url: z.string().url(),
  referrer: z.string().nullable().optional(),
  leadId: z.string().max(200).nullable().optional(),
  leadToken: z.string().max(500).nullable().optional(),
  analyticsSessionId: z.string().min(1).max(200),
  eventKey: z.string().min(1).max(300),
  funnelStep: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { visitorId, eventType, url, referrer, leadId, leadToken, analyticsSessionId, eventKey, funnelStep, metadata } = parsed.data;

  const limit = await enforceRateLimit({
    policy: "track",
    companyScope: publicCompanyRateLimitScope(),
    identifiers: [
      { kind: "visitor", value: visitorId },
      { kind: "network", value: trustedClientAddress(req) },
    ],
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const company = await getActiveCompany();
  const parsedAttr = parseAttribution(url);
  const pageHost = new URL(url).host;
  const rawReferrerHost = referrer
    ? (() => {
        try {
          return new URL(referrer).host;
        } catch {
          return null;
        }
      })()
    : null;
  const referrerHost = rawReferrerHost === pageHost ? null : rawReferrerHost;
  const attribution = resolveAttribution(parsedAttr, referrerHost);
  await recordAttributionTouch({
    companyId: company.id,
    visitorId,
    isDemo: company.isDemo,
    attribution,
  });
  // Client storage can outlive a deleted/reset Lead and is not proof of
  // ownership. Associate only when the id still belongs to this visitor and
  // company; otherwise retain a valid anonymous event instead of throwing a
  // foreign-key error or attaching activity to another homeowner.
  const candidateLead = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, companyId: company.id, visitorId },
        select: { id: true, visitorId: true },
      })
    : null;
  const associatedLead = candidateLead && verifyLeadToken({ companyId: company.id, leadId: candidateLead.id, visitorId: candidateLead.visitorId ?? "", token: leadToken }) ? candidateLead : null;

  const safeMetadata = eventType === "appointment_selected" && typeof metadata?.slotStart === "string"
    ? { slotStart: metadata.slotStart.slice(0, 40) }
    : undefined;
  const event = await recordFunnelEvent({
    companyId: company.id,
    leadId: associatedLead?.id ?? null,
    visitorId,
    eventType,
    eventKey: `public:${visitorId}:${analyticsSessionId}:${eventType}:${eventKey}`,
    funnelStep,
    isDemo: company.isDemo,
    attribution,
    metadata: safeMetadata,
  });

  return NextResponse.json({ id: event?.id, attribution });
}
