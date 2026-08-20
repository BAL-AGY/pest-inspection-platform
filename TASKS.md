# Tasks

Status reflects what has actually been built and verified (via
`npm run test`, `npx playwright test`, and `npm run build`), not what merely
has a file for it. See `docs/ARCHITECTURE.md` for the stack decisions behind
this work and the north-star metric (cost per qualified booked inspection).

## Project Foundation

- [x] Git repository confirmed
- [x] `CLAUDE.md` architecture/agent-instructions doc
- [x] `docs/ARCHITECTURE.md` — stack finalized (Next.js/TS, Prisma/SQLite-dev-Postgres-prod, Tailwind, Auth.js, Zod, Vitest, Playwright)
- [x] Next.js + TypeScript + Tailwind app scaffolded
- [x] Prisma schema: Company, User, Inspector, Lead, LeadNote, FunnelEvent, Appointment, MarketingSpend, AuditLog — all tenant-scoped by `companyId`
- [x] Local dev database (SQLite) migrated and seeded (`npm run db:seed`)
- [ ] PostgreSQL production cutover (deliberate migration step — see ARCHITECTURE.md; not done, no Postgres available in this environment)
- [ ] CI pipeline (lint/typecheck/test/build on push)

## Customer Acquisition Funnel

- [x] Mobile-first public landing page (`/`)
- [x] Attribution capture (UTM params, click IDs, referrer fallback) — `src/lib/attribution.ts`, `/api/track`
- [x] Landing page → qualification funnel wiring, verified end-to-end
- [ ] SEO metadata beyond basic title/description (structured data, sitemap, per-page metadata)
- [ ] AEO/AI-search-friendly content structure
- [ ] Additional acquisition channels/landing page variants

## Qualification Engine

- [x] Progressive, conditional qualification questionnaire — `src/lib/qualification.ts`
- [x] Service-area (ZIP) validation
- [x] Homeowner/renter logic
- [x] Existing-provider / switcher path with non-contract-interference disclaimer
- [x] Configurable, company-scoped lead scoring — `src/lib/scoring.ts` (rules stored as data on `Company.scoringRules`)
- [x] MQL / SQL classification with configurable thresholds
- [x] Contact capture wired into lead creation/update

## Scheduling

- [x] Business-hours + duration + capacity-aware availability generation — `src/lib/scheduling.ts`
- [x] Booking with double-booking prevention (app-level overlap check + DB-level unique constraint as race guard) — verified in `e2e/full-funnel.spec.ts`
- [x] Rescheduling, cancellation, no-show, completed status transitions
- [x] Inspector field on Appointment (assignment architecture present; no auto-assignment logic yet — single default inspector seeded)
- [ ] Multi-inspector load balancing / assignment rules

## CRM & Pipeline

- [x] Lead profiles (contact, property, pest concern, qualification answers, score, source)
- [x] Notes and activity timeline (funnel events) per lead
- [x] Pipeline board grouped by status (`/dashboard/leads`)
- [x] Manual status override, outcome (won/lost) with contract value

## Dashboard

- [x] Owner overview: inspections today/this week, new leads, MQL/SQL counts, completed inspections, won/lost, show rate, close rate
- [x] Funnel conversion/drop-off by stage
- [x] Mobile-responsive layout (Tailwind, tested at mobile viewport widths conceptually via responsive classes — not yet checked on a real device)
- [x] Calendar (day/week/month range views)
- [ ] Source/campaign breakdown UI on the dashboard (API exists at `/api/analytics/funnel`; no dashboard page renders it yet)

## Analytics & Attribution

- [x] Append-only funnel event log (visit → … → customer won/lost)
- [x] Stage-to-stage conversion and drop-off calculation — `src/lib/analytics.ts`
- [x] First-touch attribution persisted on Lead; per-event attribution on FunnelEvent
- [x] Cost per lead / MQL / SQL / booked inspection / completed inspection — real, computed from entered `MarketingSpend`, never fabricated (shows "no data yet" otherwise)
- [x] Customer acquisition cost, return on ad spend (both null until real spend + outcome data exist)
- [x] Marketing spend entry UI (`/dashboard/marketing`)

## Communications

- [x] Provider-abstraction interface with consent/opt-out gating (`src/lib/communications.ts`) — every send checked against consent before dispatch
- [x] Confirmation, reminder, reschedule, cancellation, and follow-up message templates
- [x] Dev provider (console log) — real send path, no live vendor wired up
- [ ] Live email/SMS provider integration (deliberately deferred — no vendor chosen; see ARCHITECTURE.md)
- [ ] Scheduled/automated reminders and qualified-not-booked follow-up (currently only fires on booking/reschedule/cancel actions, not on a timer)

## Testing

- [x] Unit tests: scoring, qualification/service-area, scheduling/double-booking, attribution, analytics, communications consent gating (51 tests, `npm run test`)
- [x] End-to-end test of the full required journey — traffic → landing → funnel → lead → scoring → MQL/SQL → availability → booking → double-booking prevention → CRM/pipeline → inspection completed → customer won → dashboard/analytics update (`npx playwright test`)
- [ ] Authorization/tenant-isolation tests (only one company exists currently, so cross-tenant isolation is architecturally present but not yet exercised by a test with two companies)
- [ ] Component-level UI tests

## Deployment

- [x] `npm run build` (production Next.js build) passes
- [ ] Dockerfile / hosting-specific deployment config
- [ ] Production environment variable documentation beyond `.env.example`
- [ ] PostgreSQL production database provisioned and migrated

## Final Integration

- [x] Realistic end-to-end scenario verified against the running app and real (SQLite) database: attribution → qualification → lead scoring → MQL/SQL → availability → booking → double-booking prevention → calendar → CRM profile → pipeline stage → dashboard → funnel analytics → inspection completed → customer won → revenue/ROI update — all confirmed working together, not fabricated
- [ ] Same scenario re-verified against PostgreSQL before real production launch
