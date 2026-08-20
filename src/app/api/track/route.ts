import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveCompany } from "@/lib/company";
import { parseAttribution, resolveAttribution } from "@/lib/attribution";
import { FUNNEL_EVENT_TYPES } from "@/lib/pipeline";
import {
  enforceRateLimit,
  publicCompanyRateLimitScope,
  rateLimitResponse,
  trustedClientAddress,
} from "@/lib/rate-limit";

const trackSchema = z.object({
  visitorId: z.string().min(1),
  eventType: z.enum(FUNNEL_EVENT_TYPES),
  url: z.string().url(),
  referrer: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { visitorId, eventType, url, referrer, leadId, metadata } = parsed.data;

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
  const referrerHost = referrer
    ? (() => {
        try {
          return new URL(referrer).host;
        } catch {
          return null;
        }
      })()
    : null;
  const attribution = resolveAttribution(parsedAttr, referrerHost);

  const event = await prisma.funnelEvent.create({
    data: {
      companyId: company.id,
      leadId: leadId ?? null,
      visitorId,
      eventType,
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      content: attribution.content,
      term: attribution.term,
      landingPage: attribution.landingPage,
      clickId: attribution.clickId,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  return NextResponse.json({ id: event.id, attribution });
}
