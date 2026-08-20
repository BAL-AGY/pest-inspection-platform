import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveCompany, parseScoringRules, parseServiceZipCodes } from "@/lib/company";
import { classifyLead, computeLeadScore, type QualificationAnswers } from "@/lib/scoring";
import { isInServiceArea, getNextQuestion } from "@/lib/qualification";
import { requireSession } from "@/lib/require-session";
import { suppressedChannels } from "@/lib/suppression";

const contactSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
});

const attributionSchema = z.object({
  source: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  campaign: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
  landingPage: z.string().nullable().optional(),
  clickId: z.string().nullable().optional(),
});

const upsertSchema = z.object({
  visitorId: z.string().min(1),
  leadId: z.string().nullable().optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  contact: contactSchema.optional(),
  attribution: attributionSchema.optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
});

const STATUS_RANK = [
  "new",
  "engaged",
  "mql",
  "sql",
  "inspection_booked",
  "inspection_completed",
  "customer_won",
  "customer_lost",
] as const;

function rank(status: string) {
  const idx = STATUS_RANK.indexOf(status as (typeof STATUS_RANK)[number]);
  return idx === -1 ? 0 : idx;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { visitorId, leadId, answers, contact, attribution, smsConsent, emailConsent } =
    parsed.data;

  const company = await getActiveCompany();
  const serviceZipCodes = parseServiceZipCodes(company);
  const scoringRules = parseScoringRules(company);

  const existing = leadId
    ? await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } })
    : await prisma.lead.findFirst({
        where: { companyId: company.id, visitorId },
        orderBy: { createdAt: "desc" },
      });

  const priorAnswers: QualificationAnswers = existing?.qualificationAnswers
    ? JSON.parse(existing.qualificationAnswers)
    : {};

  const mergedAnswers: QualificationAnswers = {
    ...priorAnswers,
    ...((answers ?? {}) as QualificationAnswers),
  };

  if (typeof mergedAnswers.zipCode === "string") {
    mergedAnswers.inServiceArea = isInServiceArea(mergedAnswers.zipCode, serviceZipCodes);
  }

  const hadContact = Boolean(existing?.email || existing?.phone);
  const nowHasContact = Boolean(contact?.email || contact?.phone || hadContact);
  if (nowHasContact) mergedAnswers.contactCaptured = true;

  const score = computeLeadScore(mergedAnswers, scoringRules);
  const classification = classifyLead(score, company.mqlThreshold, company.sqlThreshold);

  let nextStatus = existing?.status ?? "new";
  if (rank("engaged") > rank(nextStatus) && Object.keys(answers ?? {}).length > 0) {
    nextStatus = "engaged";
  }
  if (classification !== "prospect" && rank(classification) > rank(nextStatus)) {
    nextStatus = classification;
  }

  // Check the durable suppression system by normalized email/phone so a
  // previously suppressed contact can't regain marketing permission just by
  // submitting the funnel again under a new visitorId/Lead row (see
  // docs/GOAL_AUDIT.md — this is the gap this change closes).
  const resolvedEmail = contact?.email ?? existing?.email ?? null;
  const resolvedPhone = contact?.phone ?? existing?.phone ?? null;
  const suppressed = await suppressedChannels({
    companyId: company.id,
    email: resolvedEmail,
    phone: resolvedPhone,
  });
  const isSuppressedContact = suppressed.email || suppressed.sms;

  const isNew = !existing;
  const becameMql = classification === "mql" && existing?.classification !== "mql" && existing?.classification !== "sql";
  const becameSql = classification === "sql" && existing?.classification !== "sql";
  const justCapturedContact = nowHasContact && !hadContact;

  const data = {
    companyId: company.id,
    visitorId,
    firstName: contact?.firstName ?? existing?.firstName,
    lastName: contact?.lastName ?? existing?.lastName,
    email: contact?.email ?? existing?.email,
    phone: contact?.phone ?? existing?.phone,
    isHomeowner:
      typeof mergedAnswers.isHomeowner === "boolean" ? mergedAnswers.isHomeowner : existing?.isHomeowner,
    zipCode: typeof mergedAnswers.zipCode === "string" ? mergedAnswers.zipCode : existing?.zipCode,
    pestConcern: typeof mergedAnswers.pestType === "string" ? mergedAnswers.pestType : existing?.pestConcern,
    hasExistingProvider:
      typeof mergedAnswers.hasExistingProvider === "boolean"
        ? mergedAnswers.hasExistingProvider
        : existing?.hasExistingProvider,
    switchReason:
      typeof mergedAnswers.switchReason === "string" ? mergedAnswers.switchReason : existing?.switchReason,
    qualificationAnswers: JSON.stringify(mergedAnswers),
    score,
    classification,
    status: nextStatus,
    source: existing?.source ?? attribution?.source ?? null,
    medium: existing?.medium ?? attribution?.medium ?? null,
    campaign: existing?.campaign ?? attribution?.campaign ?? null,
    content: existing?.content ?? attribution?.content ?? null,
    term: existing?.term ?? attribution?.term ?? null,
    landingPage: existing?.landingPage ?? attribution?.landingPage ?? null,
    clickId: existing?.clickId ?? attribution?.clickId ?? null,
    // Suppressed channels never get (re)activated here, regardless of what
    // consent flags the request carried — a suppressed contact does not
    // silently regain marketing permission by re-entering the funnel.
    smsConsent: suppressed.sms ? false : smsConsent ?? existing?.smsConsent ?? false,
    smsConsentAt: suppressed.sms ? existing?.smsConsentAt ?? null : smsConsent ? new Date() : existing?.smsConsentAt,
    emailConsent: suppressed.email ? false : emailConsent ?? existing?.emailConsent ?? false,
    emailConsentAt: suppressed.email
      ? existing?.emailConsentAt ?? null
      : emailConsent
        ? new Date()
        : existing?.emailConsentAt,
    // Surface suppression status on the lead itself (in addition to the
    // durable, send-time gate) so the CRM shows the true state immediately
    // rather than only when a send is attempted. Never clears an
    // independently-set optedOutAt.
    optedOutAt: isSuppressedContact ? existing?.optedOutAt ?? new Date() : existing?.optedOutAt,
  };

  const lead = existing
    ? await prisma.lead.update({ where: { id: existing.id }, data })
    : await prisma.lead.create({ data });

  const eventsToLog: { eventType: "lead_created" | "contact_captured" | "mql" | "sql" }[] = [];
  if (isNew) eventsToLog.push({ eventType: "lead_created" });
  if (justCapturedContact) eventsToLog.push({ eventType: "contact_captured" });
  if (becameMql) eventsToLog.push({ eventType: "mql" });
  if (becameSql) eventsToLog.push({ eventType: "sql" });

  for (const e of eventsToLog) {
    await prisma.funnelEvent.create({
      data: {
        companyId: company.id,
        leadId: lead.id,
        visitorId,
        eventType: e.eventType,
        source: lead.source,
        medium: lead.medium,
        campaign: lead.campaign,
        content: lead.content,
        term: lead.term,
        landingPage: lead.landingPage,
        clickId: lead.clickId,
      },
    });
  }

  return NextResponse.json({
    lead,
    nextQuestion: getNextQuestion(mergedAnswers),
    inServiceArea: mergedAnswers.inServiceArea ?? null,
  });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");

  const leads = await prisma.lead.findMany({
    where: { companyId: session.companyId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ leads });
}
