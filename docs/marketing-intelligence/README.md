# Marketing Intelligence / Case Study Knowledge System

## Purpose

Use legitimate, cited pest-control marketing case studies as **prior
knowledge** so early campaign decisions are smarter and less purely
trial-and-error, before the business has enough of its own first-party data
to rely on. This system never pretends external results are our results.

Three categories are kept permanently separate everywhere in this system —
in the schema, in the calculations, and in the UI:

- **A. External industry evidence** — real, cited pest-control marketing
  case studies (`case-studies/*.json`).
- **B. Platform inferences / recommendations** — deterministic, documented
  calculations derived from (A). Never a black-box score.
- **C. Demetrius's real first-party data** — this platform's own live
  attribution/funnel data, computed exactly the same way the existing
  Marketing Performance table computes it.

A is never shown as if it were C. C is never blended into A's numbers.

## How this fits the existing architecture

See `docs/ARCHITECTURE.md` → "Marketing intelligence architecture" for the
decision record. In short:

- Case studies are **file-based, versioned repo content** (JSON files under
  `case-studies/`), not database rows — they're curated evidence, not
  tenant data, and belong in git history like everything else in `docs/`.
- The **experiment tracker** (`CampaignExperiment` in `prisma/schema.prisma`)
  *is* tenant data — it's a real per-company row — but it stores only
  planning fields (hypothesis, platform, UTM identifiers, status). It never
  stores its own copy of visitor/lead/booking/revenue counts. Those are
  always computed live by reusing `campaignPerformance()`
  (`src/lib/dashboard-metrics.ts`), the exact function that already powers
  the "Marketing performance" table on the Overview dashboard.

## Adding a new case study

1. Copy `case-studies/_TEMPLATE.json` (or any existing study) to a new file,
   e.g. `case-studies/meta-free-inspection-2025-acme.json`.
2. Fill in every required field (see `CASE-STUDY-SCHEMA.md`). Leave any
   metric the source didn't report as `null` — never estimate or invent a
   number.
3. Set `evidenceQuality` (`"high" | "medium" | "low"`) and
   `evidenceQualityReason` honestly — see `CASE-STUDY-SCHEMA.md` for the
   rubric.
4. Run `npm run test` — `case-studies.test.ts` and `case-study-schema.test.ts`
   don't validate your specific file (they use synthetic fixtures), but
   `npm run validate:case-studies` (see below) checks every file in the
   directory against the schema and will reject anything malformed.
5. Commit the new file. It's picked up automatically the next time the
   Acquisition Intelligence dashboard page renders — no seed script, no
   migration, no restart required in dev (a production deploy picks it up
   on the next build/deploy like any other repo file).

## Validating case studies

```
npm run validate:case-studies
```

Runs every file in `case-studies/*.json` through the same Zod schema the
app uses at read time (`src/lib/marketing-intelligence/case-study-schema.ts`)
and prints a pass/fail per file. A malformed file is never silently ignored
or partially loaded — it's excluded from the dashboard entirely and reported
as an error banner at the top of the Acquisition Intelligence page until
fixed.

## Ad platform adapters (Phase 9 prep)

`src/lib/ad-platforms/types.ts` defines the `AdPlatformAdapter` interface
that a future Meta Marketing API / Google Ads API integration will
implement. `meta.ts` and `google-ads.ts` are stub implementations —
`isConfigured()` checks for the expected environment variables, and every
other method throws "not implemented yet" if called. **Nothing in the app
calls these adapters yet**, so their absence never affects build, tests, or
deployment. When real credentials exist, implement the throwing methods and
wire `mapToAttribution()`'s output into `MarketingSpend`/attribution the
same way a manually-entered spend row works today.

## What's deliberately NOT here yet

- No automatic campaign changes. Recommendations are read-only advice; a
  human always decides.
- No ML/AI scoring model. Every number in `benchmarks.ts` and
  `recommendations.ts` is a named, documented, deterministic calculation —
  see `BENCHMARKS.md` and `CAMPAIGN-PLAYBOOK.md`.
- No fabricated example data in production. If `case-studies/` is empty, the
  dashboard shows honest empty states, not placeholder numbers. (Unit tests
  use clearly-marked fixture data under
  `src/lib/marketing-intelligence/__fixtures__/`, which is never read by the
  production loader.)
