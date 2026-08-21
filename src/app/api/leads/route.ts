import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getActiveCompany,
  parseScoringRules,
  parseServiceZipCodes,
  parseSupportedPests,
} from "@/lib/company";
import { classifyLead, computeLeadScore, type QualificationAnswers } from "@/lib/scoring";
import {
  deriveQualificationState,
  parseStoredQualificationAnswers,
  validateQualificationSubmission,
} from "@/lib/qualification";
import { requireSession } from "@/lib/require-session";
import { normalizeEmail, normalizePhone, suppressedChannels } from "@/lib/suppression";
import { issueLeadToken, verifyLeadToken } from "@/lib/funnel-capability";
import {
  enforceRateLimit,
  publicCompanyRateLimitScope,
  rateLimitResponse,
  trustedClientAddress,
} from "@/lib/rate-limit";

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
  // Required whenever leadId is supplied — proves this caller is the
  // visitor who actually owns that lead (see src/lib/funnel-capability.ts).
  leadToken: z.string().nullable().optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  contact: contactSchema.optional(),
  attribution: attributionSchema.optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  smsMarketingConsent: z.boolean().optional(),
  emailMarketingConsent: z.boolean().optional(),
}).strict();

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

async function saveLead(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { visitorId, leadId, leadToken, answers, contact, attribution, smsConsent, emailConsent, smsMarketingConsent, emailMarketingConsent } =
    parsed.data;

  const network = trustedClientAddress(req);
  if (!leadId) {
    const limit = await enforceRateLimit({
      policy: "leadCreate",
      companyScope: publicCompanyRateLimitScope(),
      identifiers: [
        { kind: "visitor", value: visitorId },
        { kind: "network", value: network },
      ],
    });
    if (!limit.allowed) return rateLimitResponse(limit);
  }

  const company = await getActiveCompany();
  const serviceZipCodes = parseServiceZipCodes(company);
  const supportedPests = parseSupportedPests(company);
  const scoringRules = parseScoringRules(company);

  let existing;
  if (leadId) {
    const candidate = await prisma.lead.findFirst({ where: { id: leadId, companyId: company.id } });
    if (!candidate) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // A bare leadId is never sufficient proof of ownership — verify the
    // caller was actually issued this lead's capability token. Reject as
    // forbidden (not silently falling through to visitorId lookup, which
    // would let an attacker re-target a different, self-owned lead while
    // still probing whether the guessed leadId exists).
    const owns = verifyLeadToken({
      companyId: company.id,
      leadId: candidate.id,
      visitorId: candidate.visitorId ?? "",
      token: leadToken,
    });
    if (!owns) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const limit = await enforceRateLimit({
      policy: "leadContinue",
      companyScope: company.slug,
      identifiers: [
        { kind: "lead", value: candidate.id },
        { kind: "network", value: network },
      ],
    });
    if (!limit.allowed) return rateLimitResponse(limit);
    existing = candidate;
  } else {
    // No leadId supplied: this is always treated as a request to create a
    // brand-new lead for this visitor. We deliberately do NOT look up a
    // pre-existing lead by visitorId alone and silently reattach to (and
    // hand out a fresh, valid token for) it — visitorId is never
    // sufficient proof of ownership for an EXISTING lead, the same
    // principle as the leadId branch above. An independent audit
    // confirmed this exact fallback was a real bypass: a caller who knew
    // or supplied a victim's visitorId could omit leadId entirely and the
    // server would find, mutate, and re-authorize the victim's most
    // recent lead with no proof of ownership at all (see
    // docs/GOAL_AUDIT.md, Step 17). Continuing an existing lead always
    // requires leadId + a valid leadToken, verified above — never
    // visitorId matching alone.
    existing = null;
  }

  const priorAnswers: QualificationAnswers = parseStoredQualificationAnswers(
    existing?.qualificationAnswers ?? null,
  );

  const validated = validateQualificationSubmission({
    priorAnswers,
    submittedAnswers: answers ?? {},
  });
  if (!validated.success) {
    return NextResponse.json(
      {
        error: "invalid_qualification",
        code: validated.issue.code,
        questionId: validated.issue.questionId,
        reason: validated.issue.message,
      },
      { status: 400 },
    );
  }

  const hadContact = Boolean(existing?.email || existing?.phone);
  const nowHasContact = Boolean(contact?.email || contact?.phone || hadContact);
  const qualification = deriveQualificationState({
    answers: validated.answers,
    serviceZipCodes,
    supportedPests,
    hasContact: nowHasContact,
  });
  const scoringAnswers: QualificationAnswers = {
    ...qualification.answers,
    inServiceArea: qualification.inServiceArea,
    supportedPest: qualification.supportedPest,
    contactCaptured: qualification.hasContact,
  };

  const score = computeLeadScore(scoringAnswers, scoringRules);
  // Required qualification steps are a prerequisite for MQL/SQL. Contact
  // may still be captured early, but one favorable answer cannot classify.
  const classification = qualification.complete
    ? classifyLead(score, company.mqlThreshold, company.sqlThreshold)
    : "prospect";

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
  const isNew = !existing;
  const becameMql = classification === "mql" && existing?.classification !== "mql" && existing?.classification !== "sql";
  const becameSql = classification === "sql" && existing?.classification !== "sql";
  const justCapturedContact = nowHasContact && !hadContact;

  const data = {
    companyId: company.id,
    // Frozen after creation — a continuation request's visitorId is never
    // trusted to overwrite the lead's real, ownership-token-bound
    // visitorId (see src/lib/funnel-capability.ts).
    visitorId: existing?.visitorId ?? visitorId,
    firstName: contact?.firstName ?? existing?.firstName,
    lastName: contact?.lastName ?? existing?.lastName,
    email: contact?.email ?? existing?.email,
    phone: contact?.phone ?? existing?.phone,
    normalizedEmail: resolvedEmail ? normalizeEmail(resolvedEmail) : null,
    normalizedPhone: resolvedPhone ? normalizePhone(resolvedPhone) : null,
    isHomeowner:
      typeof qualification.answers.isHomeowner === "boolean"
        ? qualification.answers.isHomeowner
        : null,
    zipCode:
      typeof qualification.answers.zipCode === "string"
        ? qualification.answers.zipCode
        : null,
    pestConcern:
      typeof qualification.answers.pestType === "string"
        ? qualification.answers.pestType
        : null,
    hasExistingProvider:
      typeof qualification.answers.hasExistingProvider === "boolean"
        ? qualification.answers.hasExistingProvider
        : null,
    switchReason:
      typeof qualification.answers.switchReason === "string"
        ? qualification.answers.switchReason
        : null,
    qualificationAnswers: JSON.stringify(qualification.answers),
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
    smsConsentAt: suppressed.sms
      ? existing?.smsConsentAt ?? null
      : smsConsent
        ? existing?.smsConsentAt ?? new Date()
        : existing?.smsConsentAt,
    smsConsentSource: smsConsent ? existing?.smsConsentSource ?? "public_funnel" : existing?.smsConsentSource,
    smsMarketingConsent: suppressed.smsMarketing
      ? false
      : smsMarketingConsent ?? existing?.smsMarketingConsent ?? false,
    smsMarketingConsentAt: smsMarketingConsent
      ? existing?.smsMarketingConsentAt ?? new Date()
      : existing?.smsMarketingConsentAt,
    smsMarketingConsentSource: smsMarketingConsent
      ? existing?.smsMarketingConsentSource ?? "public_funnel"
      : existing?.smsMarketingConsentSource,
    smsOptedOutAt: suppressed.sms ? existing?.smsOptedOutAt ?? new Date() : existing?.smsOptedOutAt,
    emailConsent: suppressed.email ? false : emailConsent ?? existing?.emailConsent ?? false,
    emailConsentAt: suppressed.email
      ? existing?.emailConsentAt ?? null
      : emailConsent
        ? existing?.emailConsentAt ?? new Date()
        : existing?.emailConsentAt,
    emailConsentSource: emailConsent
      ? existing?.emailConsentSource ?? "public_funnel"
      : existing?.emailConsentSource,
    emailMarketingConsent: suppressed.emailMarketing
      ? false
      : emailMarketingConsent ?? existing?.emailMarketingConsent ?? false,
    emailMarketingConsentAt: emailMarketingConsent
      ? existing?.emailMarketingConsentAt ?? new Date()
      : existing?.emailMarketingConsentAt,
    emailMarketingConsentSource: emailMarketingConsent
      ? existing?.emailMarketingConsentSource ?? "public_funnel"
      : existing?.emailMarketingConsentSource,
    emailOptedOutAt: suppressed.email ? existing?.emailOptedOutAt ?? new Date() : existing?.emailOptedOutAt,
    // Surface suppression status on the lead itself (in addition to the
    // durable, send-time gate) so the CRM shows the true state immediately
    // rather than only when a send is attempted. Never clears an
    // independently-set optedOutAt.
    optedOutAt: existing?.optedOutAt,
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
        visitorId: lead.visitorId ?? visitorId,
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

  const issuedLeadToken = issueLeadToken({
    companyId: company.id,
    leadId: lead.id,
    visitorId: lead.visitorId ?? visitorId,
  });

  return NextResponse.json({
    lead,
    leadToken: issuedLeadToken,
    nextQuestion: qualification.nextQuestion,
    qualificationComplete: qualification.complete,
    eligibleForBooking: qualification.eligibleForBooking && classification === "sql",
    inServiceArea: qualification.inServiceArea,
    supportedPest: qualification.supportedPest,
  });
}

export async function POST(req: NextRequest) {
  try {
    return await saveLead(req);
  } catch {
    // Dependency/configuration failures must still honor this JSON API's
    // response contract. Do not expose database, Redis, or secret details.
    return NextResponse.json(
      {
        error: "internal_error",
        reason: "We couldn't save your information right now. Please try again shortly.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
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
