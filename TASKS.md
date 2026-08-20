# Tasks

Status reflects what has actually been built and verified (via
`npm run test`, `npx playwright test`, and `npm run build`), not what merely
has a file for it. See `docs/ARCHITECTURE.md` for the stack decisions and
system architecture, `docs/DATA_MODEL.md` for the entity model,
`docs/EVENTS.md` for the event taxonomy, `docs/STATES.md` for the
Lead/Appointment state machines, and `docs/GOAL_AUDIT.md` for the full
requirement-by-requirement audit against the master /goal — all reviewed
and current as of 2026-08-20.

**2026-08-20 full-goal audit**: `npm run test` (51/51), `npx tsc --noEmit`
(0 errors), `npm run lint` (0 errors), `npm run build` (succeeds, all 19
routes), and `npx playwright test` (1/1, live) were all re-run fresh as
part of this audit and passed — the full required homeowner journey
(traffic → landing → funnel → contact capture → scoring → SQL → booking →
double-booking prevention → CRM/pipeline → completion → won → dashboard/
analytics/ROI) is confirmed working end-to-end right now, not just
claimed. That same audit also found two concrete inconsistencies in
already-"complete" features (marked **(bug, audit)** below) and several
missing pieces (marked **(gap, audit)**) — see `docs/GOAL_AUDIT.md` for
full evidence and the prioritized Critical Path. Items marked
**(gap, prior)** were added by the 2026-08-20 architecture-review pass
before this audit.

## 1. Foundation

- [x] Git repository confirmed
- [x] `CLAUDE.md` architecture/agent-instructions doc
- [x] `docs/ARCHITECTURE.md` — stack finalized (Next.js/TS,
      Prisma/SQLite-dev-Postgres-prod, Tailwind, Auth.js, Zod, Vitest,
      Playwright) and system-architecture detail added
- [x] Next.js + TypeScript + Tailwind app scaffolded
- [ ] PostgreSQL production cutover (deliberate migration step — see
      ARCHITECTURE.md; not done, no Postgres available in this environment)
- [ ] CI pipeline (lint/typecheck/test/build/e2e on push — all currently
      pass locally but only when run manually; see `docs/GOAL_AUDIT.md`
      Critical Path item 8)

## 2. Database

- [x] Prisma schema: Company, User, Inspector, Lead, LeadNote, FunnelEvent,
      Appointment, MarketingSpend, AuditLog — all tenant-scoped by
      `companyId`
- [x] Local dev database (SQLite) migrated and seeded (`npm run db:seed`)
- [x] Data model documented entity-by-entity with simplification rationale
      — `docs/DATA_MODEL.md`
- [x] **(fixed 2026-08-20 — Step 11)** `Communication` table (delivery log —
      one row per send attempt, blocked/sent/failed) — `prisma/schema.prisma`,
      migration `20260820205053_add_communication_log`
- [x] **(fixed 2026-08-20 — Step 9)** `SuppressionEntry` table (company-scoped
      opt-out list keyed by normalized email/phone, independent of any one
      Lead row) — `prisma/schema.prisma`, migration
      `20260820203841_add_suppression_entry`
- [ ] **(gap, prior)** Lead score/classification change history (currently
      not written to `AuditLog`)

## 3. Authentication

- [x] Auth.js (NextAuth) v5, credentials provider, bcrypt password hashing
- [x] JWT session carrying `companyId` and `role`
- [ ] **(gap, prior)** Role-based authorization — `role` (`owner`/`staff`) is
      carried but does not currently gate any route or UI differently
- [ ] **(gap, audit)** No rate limiting on public unauthenticated endpoints
      (`/api/leads` POST, `/api/track`, `/api/appointments` POST) — no
      `middleware.ts` exists. Needed before real public traffic.
- [ ] **(gap, audit)** Tenant/company isolation is architecturally correct
      by code inspection (every query scoped by `session.companyId`) but
      only one `Company` exists, so it has never been exercised by a test
      proving cross-tenant queries actually return nothing

## 4. Public landing page

- [x] Mobile-first public landing page (`/`)
- [x] Attribution capture (UTM params, click IDs, referrer fallback) —
      `src/lib/attribution.ts`, `/api/track`
- [x] Landing page → qualification funnel wiring, verified end-to-end
- [ ] SEO metadata beyond basic title/description (structured data,
      sitemap, per-page metadata)
- [ ] AEO/AI-search-friendly content structure
- [ ] Additional acquisition channels/landing page variants

## 5. Qualification funnel

- [x] Progressive, conditional qualification questionnaire —
      `src/lib/qualification.ts`
- [x] Service-area (ZIP) validation
- [x] Homeowner/renter logic
- [x] Existing-provider/switcher path with non-contract-interference
      disclaimer
- [x] Contact capture wired into lead creation/update
- [ ] **(gap, prior)** `assessment_step_completed` / `cta_clicked` event
      instrumentation — only `assessment_start` is tracked; per-question
      drop-off inside the funnel isn't measurable — `docs/EVENTS.md`

## 6. Lead scoring

- [x] Configurable, company-scoped lead scoring — `src/lib/scoring.ts`
      (rules stored as data on `Company.scoringRules`)
- [x] MQL/SQL classification with configurable thresholds
- [ ] No admin UI to edit scoring rules/thresholds (currently DB/seed only
      — see Settings, milestone 14)

## 7. Scheduling

- [x] Business-hours + duration + capacity-aware availability generation —
      `src/lib/scheduling.ts`
- [x] Booking with double-booking prevention (app-level overlap check +
      DB-level unique constraint as race guard) — verified in
      `e2e/full-funnel.spec.ts`
- [x] Reschedule (in place), cancellation, no-show, completed status
      transitions
- [x] Inspector field on Appointment (assignment architecture present; no
      auto-assignment logic yet — single default inspector seeded)
- [x] Full transition logic documented, including two inconsistencies
      worth resolving — `docs/STATES.md`
- [ ] Multi-inspector load balancing / assignment rules
- [ ] Per-inspector `AvailabilityRule` entity (today availability is
      company-wide, not per inspector)
- [ ] **(gap, prior)** `Appointment.status = "rescheduled"` and
      `rescheduledFromId` are declared but never set by the reschedule
      action — either start using them or remove them — `docs/STATES.md`
- [x] **(bug, audit — fixed 2026-08-20)** CRM-vs-API cancellation
      inconsistency resolved: both the CRM lead-detail page's
      `cancelAppointment` server action and `PATCH /api/appointments/[id]`
      (`action: "cancel"`) now call one shared function,
      `cancelAppointmentAndNotify` (`src/lib/appointment-actions.ts`), so
      status update, the sql-status reversion, and the cancellation email
      can't drift apart again. Verified behaviorally against the real dev
      DB (email send + status reversion confirmed) and via
      `npm run test` (51/51), `npx tsc --noEmit`, `npm run lint`,
      `npm run build`, and `npx playwright test` (all passing after the
      change).

## 8. CRM

- [x] Lead profiles (contact, property, pest concern, qualification
      answers, score, source)
- [x] Notes and activity timeline (funnel events) per lead
- [x] Pipeline board grouped by status (`/dashboard/leads`)
- [x] Manual status override, outcome (won/lost) with contract value
- [ ] **(gap, prior)** No server-side guard on manual Lead status
      transitions (any status → any status is currently accepted) —
      confirm this is an intentional choice, or add a transition-validity
      check — `docs/STATES.md`

## 9. Pipeline

- [x] Lead state machine (new → engaged → mql → sql → inspection_booked →
      inspection_completed → customer_won/lost) implemented and documented
      — `docs/STATES.md`
- [x] Appointment state machine (booked → cancelled/no_show/completed,
      reschedule in place) implemented and documented — `docs/STATES.md`
- [x] Status changes on the pipeline board persist via `PATCH
      /api/leads/[id]`, audit-logged
- [ ] **(gap, prior)** `AuditLog` coverage is inconsistent — appointment
      cancel/no-show/complete are not logged, only reschedule and Lead
      status changes are
- [ ] **(gap, prior)** `inspection_rescheduled`/`inspection_cancelled`/
      `inspection_no_show` are not written to the `FunnelEvent` log —
      `Appointment.status` is correct but these transitions are invisible
      to funnel analytics — `docs/EVENTS.md`

## 10. Dashboard

- [x] Owner overview: inspections today/this week, new leads, MQL/SQL
      counts, completed inspections, won/lost, show rate, close rate
- [x] Funnel conversion/drop-off by stage
- [x] Mobile-responsive layout (Tailwind, tested at mobile viewport widths
      conceptually via responsive classes — not yet checked on a real
      device)
- [x] Calendar (day/week/month range views)
- [ ] Source/campaign breakdown UI on the dashboard (API exists at
      `/api/analytics/funnel`; no dashboard page renders it yet)

## 11. Attribution

- [x] Append-only funnel event log (visit → … → customer won/lost)
- [x] First-touch attribution persisted on Lead; per-event attribution
      column exists on FunnelEvent
- [x] Full event taxonomy and firing-site documentation — `docs/EVENTS.md`
- [ ] **(gap, prior)** Only the two client-fired events (`visit`,
      `assessment_start`) resolve attribution fresh per hit; server-fired
      events inherit the lead's first-touch attribution or carry none —
      true multi-touch/last-touch attribution isn't derivable today

## 12. Analytics

- [x] Stage-to-stage conversion and drop-off calculation —
      `src/lib/analytics.ts`
- [x] Cost per lead / MQL / SQL / booked inspection / completed
      inspection — real, computed from entered `MarketingSpend`, never
      fabricated (shows "no data yet" otherwise)
- [x] Customer acquisition cost, return on ad spend (both null until real
      spend + outcome data exist)
- [x] Marketing spend entry UI (`/dashboard/marketing`)

## 13. Communications

- [x] Provider-abstraction interface with consent/opt-out gating
      (`src/lib/communications.ts`) — every send checked against consent
      before dispatch
- [x] Confirmation, reminder, reschedule, cancellation, and follow-up
      message templates
- [x] Dev provider (console log) — real send path, no live vendor wired up
- [x] **(fixed 2026-08-20 — Step 11)** `Communication` delivery log (see
      Database, milestone 2) — `src/lib/communication-log.ts`'s
      `logCommunication()`, written exclusively from the shared send gate
      (`sendIfAllowed()` in `src/lib/suppression.ts`), so booking
      confirmation, reschedule, and cancellation sends all log without any
      call site duplicating the logic. One row per send *attempt*: status
      is `blocked` (suppressed or missing/absent consent, with
      `blockedReason`), `sent` (provider accepted — not proof of delivery),
      or `failed` (provider threw or declined, with `failureReason`).
      `queued`/`delivered`/`bounced`/`undeliverable` are declared in
      `COMMUNICATION_TYPES`/`COMMUNICATION_STATUSES` (`src/lib/pipeline.ts`)
      for a future async/webhook-driven provider but nothing writes them
      yet. Queryable via `GET /api/leads/[id]` (`lead.communications`); no
      CRM UI renders it (out of scope for this fix). See
      `docs/GOAL_AUDIT.md` for full detail.
- [x] **(fixed 2026-08-20 — Step 9)** Durable, cross-lead/cross-session
      suppression — `src/lib/suppression.ts`. A contact who opts out is
      recorded in `SuppressionEntry` (normalized email/phone, company-scoped)
      and stays suppressed even when a new `Lead` row is created under a new
      `visitorId`. The shared send gate (`sendIfAllowed`, used by every send
      call site: booking confirmation, reschedule, cancellation) checks
      suppression before per-lead consent. Lead creation/contact capture
      (`POST /api/leads`) checks suppression and will not (re)activate
      `smsConsent`/`emailConsent` for a suppressed identifier, and surfaces
      `optedOutAt` on the new Lead row. Opting a lead out via the existing
      CRM mechanism (`PATCH /api/leads/[id]` `{ optedOut: true }`) now also
      writes to `SuppressionEntry`. See `docs/GOAL_AUDIT.md` for full
      before/after detail, the marketing-vs-transactional limitation
      (no distinction exists in the current system, so suppression blocks
      all sends uniformly, matching existing `canSend` behavior), and what's
      still open (no suppression-management UI, no un-suppress flow).
- [x] **(bug, audit — fixed 2026-08-20)** Cancellation messages now send
      consistently regardless of which UI path staff use (see Scheduling,
      milestone 7, for the fix)
- [ ] **(gap, audit)** Reminder message template exists
      (`MESSAGE_TEMPLATES.appointmentReminder`) but nothing triggers it —
      no scheduled/timed job exists to actually send reminders
- [ ] Live email/SMS provider integration (deliberately deferred — no
      vendor chosen; see ARCHITECTURE.md)
- [ ] Scheduled/automated reminders and qualified-not-booked follow-up
      (currently only fires on booking/reschedule/cancel actions, not on a
      timer)

## 14. Settings

- [ ] Owner-facing UI to edit `Company` config currently only editable via
      seed/DB: service ZIP codes, supported pests, business hours,
      inspection duration/capacity, scoring rules, MQL/SQL thresholds,
      average contract value/commission assumptions
- [ ] Role-based access control tied to the `Settings` surface once it
      exists (pairs with milestone 3's authorization gap)

## 15. Testing

- [x] Unit tests: scoring, qualification/service-area,
      scheduling/double-booking, attribution, analytics, communications
      consent gating, suppression normalization/tenant-scoping/shared-gate,
      communication delivery logging (blocked/sent/failed, tenant+lead
      scoping) (70 tests, `npm run test` — re-verified passing 2026-08-20)
- [x] End-to-end test of the full required journey — traffic → landing →
      funnel → lead → scoring → MQL/SQL → availability → booking →
      double-booking prevention → CRM/pipeline → inspection completed →
      customer won → dashboard/analytics update (`npx playwright test` —
      re-verified passing live, 2026-08-20)
- [x] **(added 2026-08-20 — Step 9)** End-to-end test of durable suppression
      (`e2e/suppression.spec.ts`): opt-out persists, a brand new Lead under a
      new visitorId with the same email/phone stays suppressed and cannot
      reactivate consent, an unrelated contact is unaffected — run live
      against the real dev DB, passing. (Fixed a pre-existing repeatability
      bug in this spec during Step 11: hardcoded, non-stamped phone numbers
      meant the durable suppression written on the first run would fail the
      test on every subsequent run against the same persistent dev DB — now
      stamped like the email already was.)
- [x] **(added 2026-08-20 — Step 11)** End-to-end tests of communication
      delivery logging (`e2e/communication-log.spec.ts`): booking
      confirmation, reschedule, and cancellation each persist a `sent`
      `Communication` record tied to the correct lead/appointment; a
      suppressed contact's booking confirmation persists as `blocked` —
      run live against the real dev DB, passing (re-run twice to confirm
      repeatability)
- [x] Type checking (`npx tsc --noEmit` — 0 errors, 2026-08-20)
- [x] Linting (`npm run lint` — 0 errors, 2026-08-20)
- [ ] Authorization/tenant-isolation tests (only one company exists
      currently, so cross-tenant isolation is architecturally present but
      not yet exercised by a test with two companies). Exception:
      `SuppressionEntry` company-scoping is unit-tested directly
      (`src/lib/suppression.test.ts`) since every query is asserted to
      include `companyId` — this covers the query-construction logic but is
      not a substitute for a real two-company end-to-end test.
- [ ] Component-level UI tests
- [ ] **(gap, audit)** Additional e2e scenarios: reschedule flow, lost
      outcome, no-show, second-company isolation — only the single happy
      path + one double-booking conflict is currently covered

## 16. Deployment

- [x] `npm run build` (production Next.js build) passes
- [ ] Dockerfile / hosting-specific deployment config
- [ ] Production environment variable documentation beyond `.env.example`
- [ ] PostgreSQL production database provisioned and migrated

## 17. Final integration

- [x] Realistic end-to-end scenario verified against the running app and
      real (SQLite) database: attribution → qualification → lead scoring →
      MQL/SQL → availability → booking → double-booking prevention →
      calendar → CRM profile → pipeline stage → dashboard → funnel
      analytics → inspection completed → customer won → revenue/ROI
      update — all confirmed working together, not fabricated
- [ ] Same scenario re-verified against PostgreSQL before real production
      launch
- [ ] Highest-priority gaps from this review (suppression list,
      communication log, missing appointment-lifecycle events) closed
      before production launch, given the compliance boundaries in
      `docs/ARCHITECTURE.md`
