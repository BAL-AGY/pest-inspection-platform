# Case Study Schema

Canonical source: `src/lib/marketing-intelligence/case-study-schema.ts` (Zod).
This document explains the *why* behind each field; the code is the
authoritative validation.

## Core rule

**Every numeric metric is optional and nullable.** A source that didn't
report a number leaves that field `null` (or omitted). The loader
(`case-studies.ts`) and every downstream calculation (`benchmarks.ts`,
`recommendations.ts`) treat a missing value as "unknown," never as zero and
never as an estimate. This is enforced by `.strict()` on the schema (extra,
unrecognized fields are rejected) and by using `.nullable().optional()` on
every reported-metric field rather than a default value.

## Fields

### What the study is about

| Field | Type | Notes |
|---|---|---|
| `id` | string, required | Unique, stable, e.g. `meta-free-inspection-2025-acme` |
| `companyOrCampaignName` | string \| null | Only if publicly disclosed |
| `pestCategory` | string, required | Free text, e.g. `general_pest`, `termite`, `mosquito`, `rodent` |
| `platform` | enum, required | `meta` \| `google_search` \| `google_local_services` \| `seo` \| `other` |
| `campaignObjective` | string \| null | |
| `targetAudience` | string \| null | |
| `offer` | string \| null | e.g. `free_inspection`, `discount`, `contact_us` — this is the key dimension benchmarks and hypotheses segment by |
| `cta` | string \| null | |
| `creativeType` | string \| null | e.g. `video`, `carousel`, `static image` |
| `hookOrMessage` | string \| null | |
| `landingPageStrategy` | string \| null | |
| `targetingStrategy` | string \| null | |
| `serviceType` | enum, default `unknown` | `recurring` \| `one_time` \| `unknown` |
| `seasonality` | string \| null | |
| `testingDurationDays` | integer \| null | |
| `geography` | string \| null | |

### Reported metrics (all nullable)

`reportedAdSpendCents`, `reportedImpressions`, `reportedClicks`,
`reportedCtr` (0–1 fraction), `reportedCpcCents`, `reportedLeads`,
`reportedCplCents`, `reportedBookedInspections`, `reportedBookingRate`
(0–1 fraction), `reportedCustomers`, `reportedCacCents`,
`reportedRevenueCents`, `reportedRoas` (multiple, e.g. `3.1` = 3.1x).

`reportedResult` (free text — the source's own summary sentence),
`notes`, `limitations`.

### Source / evidence quality (all required except `publicationDate`)

| Field | Notes |
|---|---|
| `sourceTitle` | Exact title of the article/report |
| `sourceUrl` | Must be a valid URL |
| `publisher` | Who published it |
| `publicationDate` | ISO date, only if the source states one |
| `dateAccessed` | ISO date — when you personally verified the source, required even if `publicationDate` is unknown |
| `evidenceQuality` | `high` \| `medium` \| `low` — see below |
| `evidenceQualityReason` | Required, one sentence explaining the tier |

## Evidence quality rubric

**HIGH** — an actual pest-control campaign, a clear/named source, real
numeric results, and methodology or context reasonably documented (e.g. an
agency case study with dates, spend, and a described testing approach).

**MEDIUM** — a relevant pest-control campaign with useful metrics, but some
methodology or context is missing (e.g. a platform's own aggregated
benchmark report without company-level detail).

**LOW** — a marketing claim with weak supporting information: incomplete
data, unclear methodology, or a vague "X% better" claim without the
underlying numbers.

`evidenceQuality` is assigned by whoever adds the study (a human judgment
call about the *source*, not something the app infers), and
`evidenceQualityReason` must say why. The benchmark and recommendation
engines both use this tier — see `BENCHMARKS.md` and `CAMPAIGN-PLAYBOOK.md`.

## Derived metrics

Some benchmark metrics (e.g. "cost per booked inspection") aren't a field
above — they're computed at read time from two fields the *same study*
reported (e.g. `reportedAdSpendCents ÷ reportedBookedInspections`), only
when both are present, and only as a fallback when the study didn't
directly report that metric. See `deriveMetric()` in `benchmarks.ts`.
