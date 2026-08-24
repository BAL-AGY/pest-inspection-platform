import { z } from "zod";

// A pest-control marketing case study, sourced from real, cited, external
// evidence (an agency write-up, a platform case study, a trade publication,
// etc.) — never fabricated. Every numeric field is optional: a source that
// didn't report a metric leaves it `null`/absent here rather than having a
// value invented for it. See docs/marketing-intelligence/CASE-STUDY-SCHEMA.md
// for the full field-by-field rationale and docs/marketing-intelligence/README.md
// for how to add a new one.

export const EVIDENCE_QUALITY_VALUES = ["high", "medium", "low"] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITY_VALUES)[number];

export const PLATFORM_VALUES = [
  "meta",
  "google_search",
  "google_local_services",
  "seo",
  "other",
] as const;
export type Platform = (typeof PLATFORM_VALUES)[number];

export const SERVICE_TYPE_VALUES = ["recurring", "one_time", "unknown"] as const;
export type ServiceType = (typeof SERVICE_TYPE_VALUES)[number];

// A non-negative finite number, or omitted/null when the source didn't
// report it. Never coerce a missing metric to 0 — 0 means the source
// explicitly reported zero.
const reportedNumber = z.number().finite().nonnegative().nullable().optional();

export const caseStudySchema = z
  .object({
    id: z.string().min(1).max(100),

    // What the study is about
    companyOrCampaignName: z.string().min(1).max(200).nullable().optional(),
    pestCategory: z.string().min(1).max(100), // free text, e.g. "general_pest", "termite", "mosquito"
    platform: z.enum(PLATFORM_VALUES),
    campaignObjective: z.string().max(300).nullable().optional(),
    targetAudience: z.string().max(300).nullable().optional(),
    offer: z.string().max(200).nullable().optional(), // e.g. "free_inspection", "discount", "contact_us"
    cta: z.string().max(200).nullable().optional(),
    creativeType: z.string().max(200).nullable().optional(),
    hookOrMessage: z.string().max(500).nullable().optional(),
    landingPageStrategy: z.string().max(500).nullable().optional(),
    targetingStrategy: z.string().max(500).nullable().optional(),
    serviceType: z.enum(SERVICE_TYPE_VALUES).default("unknown"),
    seasonality: z.string().max(200).nullable().optional(),
    testingDurationDays: z.number().int().positive().nullable().optional(),
    geography: z.string().max(200).nullable().optional(),

    // Reported metrics — every one nullable/optional, never fabricated
    reportedAdSpendCents: reportedNumber,
    reportedImpressions: reportedNumber,
    reportedClicks: reportedNumber,
    reportedCtr: reportedNumber, // 0-1 fraction
    reportedCpcCents: reportedNumber,
    reportedLeads: reportedNumber,
    reportedCplCents: reportedNumber,
    reportedBookedInspections: reportedNumber,
    reportedBookingRate: reportedNumber, // 0-1 fraction, leads -> booked
    reportedCustomers: reportedNumber,
    reportedCacCents: reportedNumber,
    reportedRevenueCents: reportedNumber,
    reportedRoas: reportedNumber, // multiple, e.g. 3.1 = 3.1x

    reportedResult: z.string().max(1000).nullable().optional(), // the source's own summary sentence(s)
    notes: z.string().max(2000).nullable().optional(),
    limitations: z.string().max(1000).nullable().optional(),

    // Source / evidence quality — required, never inferred
    sourceTitle: z.string().min(1).max(300),
    sourceUrl: z.string().url(),
    publisher: z.string().min(1).max(200),
    publicationDate: z.string().date().nullable().optional(), // ISO date, if the source states one
    dateAccessed: z.string().date(),

    evidenceQuality: z.enum(EVIDENCE_QUALITY_VALUES),
    evidenceQualityReason: z.string().min(1).max(500),
  })
  .strict();

export type CaseStudy = z.infer<typeof caseStudySchema>;

export interface CaseStudyValidationError {
  file: string;
  issues: string[];
}

export function parseCaseStudy(file: string, raw: unknown): { study: CaseStudy } | { error: CaseStudyValidationError } {
  const result = caseStudySchema.safeParse(raw);
  if (!result.success) {
    return {
      error: {
        file,
        issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
    };
  }
  return { study: result.data };
}
