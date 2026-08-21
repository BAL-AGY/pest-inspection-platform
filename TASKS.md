# Tasks

Status reflects what has actually been built and verified (via
`npm run test`, `npx playwright test`, and `npm run build`), not what merely
has a file for it. See `docs/ARCHITECTURE.md` for the stack decisions and
system architecture, `docs/DATA_MODEL.md` for the entity model,
`docs/EVENTS.md` for the event taxonomy, `docs/STATES.md` for the
Lead/Appointment state machines, and `docs/GOAL_AUDIT.md` for the full
requirement-by-requirement audit against the master /goal — all reviewed
and current as of 2026-08-20.

**2026-08-21 demo-readiness checkpoints:** The real homeowner path now handles
empty/non-JSON/error API responses without crashing or advancing unsaved
answers. The expanded browser journey verifies landing UTM preservation,
qualification, booking/confirmation, owner login, readable qualification and
attribution detail, calendar linkage, notes, completion, outcome, and dashboard
updates. Lead-detail Server Actions reauthenticate and reassert tenant/lead/
appointment ownership before writes. The analytics checkpoint's final full
verification is 144/144 Vitest and 42/42 Playwright tests, plus typecheck,
lint, empty-PostgreSQL migration/seed, Redis coverage, production build, and
`git diff --check`.

**Demo economics and attribution:** Dashboard metrics now include combined
qualified leads, lead-to-qualified and qualified-to-booked conversion, cost per
qualified lead, attendance-outcome show rate, close rate, CAC, ROAS, ROI, and a
source/campaign table covering leads → qualified → booked → won → attributed
contract value. Counts are unique by Lead where appropriate, so repeated events
or appointments do not inflate source performance. The landing CTA preserves
UTMs, and tracking associates a `leadId` only when company/visitor and the
lead-ownership capability all match.

**2026-08-21 production analytics checkpoint:** The canonical, idempotent event
log now covers landing/CTA/start, each validated qualification step, contact,
qualification outcome, scheduling, booking lifecycle, customer outcome, and
actual revenue. First and last attribution persist from anonymous visitor to
lead/outcome. Company-timezone ranges, question drop-off, source/medium/campaign/
creative economics, explicit unavailable values, tenant/demo isolation, and a
redesigned owner overview are implemented and covered by PostgreSQL-backed and
browser tests. See `docs/ANALYTICS.md` and `docs/EVENTS.md`.

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
      Prisma/PostgreSQL, Tailwind, Auth.js, Zod, Vitest,
      Playwright) and system-architecture detail added
- [x] Next.js + TypeScript + Tailwind app scaffolded
- [x] **(Step 22)** PostgreSQL architecture cutover: PostgreSQL-native Prisma
      provider/baseline, `TIMESTAMPTZ(3)` instants, empty-database migration,
      seed, full application suite, and real concurrency verification against
      PostgreSQL 17.11. Managed production provisioning remains a deployment
      task. See `docs/POSTGRESQL.md`.
- [ ] CI pipeline (lint/typecheck/test/build/e2e on push — all currently
      pass locally but only when run manually; see `docs/GOAL_AUDIT.md`
      Critical Path item 8)

## 2. Database

- [x] Prisma schema: Company, User, Inspector, Lead, LeadNote, FunnelEvent,
      Appointment, MarketingSpend, AuditLog — all tenant-scoped by
      `companyId`
- [x] Local PostgreSQL database migrated and seeded (`npm run db:deploy`,
      `npm run db:seed`); former SQLite migrations retained as an archive only
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
- [x] **(implemented Step 18; distributed backend hardening Step 23)** Central public-API rate
      limiting (`src/lib/rate-limit.ts`) with per-action policies for lead
      creation/continuation, tracking, availability, booking, and Auth.js
      POST actions; privacy-hashed identifiers; explicit trusted-proxy
      configuration; `429` + `Retry-After`; and a swappable
      `RateLimitStore`. Real-route tests prove normal requests succeed,
      excess writes are limited, identifiers stay isolated, and limited
      requests add no DB rows. Production now requires a shared Redis store;
      atomic Lua increments/expiry are verified with concurrent requests from
      two independent clients. Backend failures fail closed with `503` rather
      than silently disabling protection. In-memory storage remains available
      only as a development/test fallback when `REDIS_URL` is absent. See
      `docs/ENDPOINT_SECURITY.md`.
- [ ] **(gap, audit)** Tenant/company isolation is architecturally correct
      by code inspection (every query scoped by `session.companyId`) but
      only one `Company` exists, so it has never been exercised by a test
      proving cross-tenant queries actually return nothing. Additionally
      (2026-08-21 Codex audit, confirmed): public routes resolve tenant
      via `getActiveCompany()` with no request-derived tenant signal at
      all — a deliberate, documented single-tenant-for-v1 scope, not a
      live vulnerability today, but needs real tenant resolution before a
      second company goes live.
- [x] **(fixed 2026-08-21 — Step 15; continuation-bypass closed + secret/
      lifetime hardened Step 17)** Public lead ownership / IDOR
      protection. An independent audit (OpenAI Codex) found, and direct
      code inspection confirmed, that `POST /api/leads` continuation,
      `POST /api/appointments`, and `GET /api/availability` trusted a bare
      `leadId` with no proof the caller was the visitor who created it —
      anyone who obtained a lead's id could rewrite its contact/consent or
      book its slot. Fixed with `src/lib/funnel-capability.ts`: an
      HMAC-signed capability token, derived from the lead's real
      server-side `visitorId`, issued on every lead-scoped response and
      required on every subsequent request (JSON body field, or
      `X-Funnel-Token` header for the GET availability route so it doesn't
      leak into browser history the way `leadId` itself already does).
      `visitorId` is frozen after creation.
      **Step 17 (same day): a second adversarial review found this fix
      was incomplete.** `POST /api/leads`' "no leadId" branch still looked
      up and mutated any existing lead by `visitorId` alone — no token
      check — and handed back a fresh valid token for it, so knowing a
      victim's `visitorId` (not just their `leadId`) still fully hijacked
      their lead. Root cause: that branch didn't distinguish true
      first-time creation (nothing to protect) from continuing a lead
      that already exists (must be authenticated). Fixed by treating "no
      leadId" as unconditionally "create a new lead" — never a
      `visitorId`-based reattachment to an existing one. Also hardened:
      `FUNNEL_CAPABILITY_SECRET` now fails closed in production with no
      `AUTH_SECRET` fallback (enforced at startup via
      `src/instrumentation.ts` and per-request), and tokens now expire
      after 4 hours (`LEAD_TOKEN_TTL_MS`) instead of being valid
      indefinitely — every successful response re-issues a fresh token, so
      an actively continuing visitor never approaches the limit. Both the
      Step 15 and Step 17 fixes were sanity-checked by temporarily
      reverting each and confirming its adversarial test genuinely fails,
      then re-applying. `POST /api/track` remains deliberately unprotected
      — it only writes an informational event row, never reads/mutates
      lead data back. **Documented, deliberately deferred limitation**:
      the token is stored in `localStorage`, not an `httpOnly` cookie —
      see `docs/ARCHITECTURE.md` Known gaps item 12 for the honest
      analysis (it does not meaningfully weaken protection against an
      *active* same-origin XSS attacker, but a token leaked another way
      is replayable until it expires). A full re-audit of every route
      accepting `leadId`/`visitorId`/`companyId`/a token found no further
      instance of this bypass pattern. See `docs/GOAL_AUDIT.md` and
      `docs/ARCHITECTURE.md` for full detail.
- [x] **(fixed — Step 21)** Production credential and seed hardening.
      `src/lib/environment.ts` centrally requires strong, independent
      `AUTH_SECRET`, `FUNNEL_CAPABILITY_SECRET`, and
      `RATE_LIMIT_IDENTIFIER_SECRET` values in production; common
      placeholders, values shorter than 32 characters, missing values, and
      cross-secret reuse fail startup and sensitive runtime paths without
      logging values. `prisma/seed.ts` retains deterministic dev/test data but
      requires explicit non-development owner credentials in production,
      never logs plaintext passwords, and never overwrites an existing hash.
      See `docs/PRODUCTION_SETUP.md`.

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
- [x] CTA, funnel-start, and authoritative per-question instrumentation with
      question-level drop-off reporting — `docs/EVENTS.md`
- [x] **(fixed — Step 19)** Server-authoritative qualification validation.
      `src/lib/qualification.ts` centrally declares question IDs, types,
      required/conditional behavior, option values, ZIP validation,
      ordered progression, safe single-answer correction, company service-area/
      supported-pest checks, and booking prerequisites. `/api/leads`
      rejects unknown/malformed/out-of-order answers and direct score/
      classification/status fields; score and MQL/SQL remain recomputed
      only from sanitized answers. Availability and booking re-derive the
      complete authoritative state. See `docs/QUALIFICATION.md`.

## 6. Lead scoring

- [x] Configurable, company-scoped lead scoring — `src/lib/scoring.ts`
      (rules stored as data on `Company.scoringRules`)
- [x] MQL/SQL classification with configurable thresholds
- [ ] No admin UI to edit scoring rules/thresholds (currently DB/seed only
      — see Settings, milestone 14)

## 7. Scheduling

- [x] Business-hours + duration + capacity-aware availability generation —
      `src/lib/scheduling.ts`, company-timezone authoritative as of Step 20.
- [x] **(fixed 2026-08-21 — Step 15)** Booking with atomic double-booking
      prevention. An independent audit (OpenAI Codex) found, and a
      standalone verification script confirmed, that the prior DB-level
      guard (`@@unique([inspectorId, scheduledStart])`) never actually
      worked: every booking has `inspectorId = null`, and SQL unique
      indexes treat NULLs as distinct, so it never fired — double-booking
      prevention rested entirely on a non-atomic check-then-insert read.
      Replaced with a partial unique index on `(companyId, scheduledStart)`
      filtered to active statuses in the PostgreSQL baseline (not expressible
      as a Prisma `@@unique`), plus authoritative `Serializable` transactions.
      **Step 22:** `runSerializableTransaction()` adds a bounded three-attempt
      retry for genuine Prisma `P2034` conflicts, rerunning the full capacity
      check. PostgreSQL 17.11 live-route tests prove simultaneous same-slot
      requests persist one row; different-time requests at `capacity - 1`
      persist only one; concurrent reschedules do not exceed destination
      capacity and the failed move preserves its source; cancellation releases
      slot/capacity. See `docs/POSTGRESQL.md`.
- [x] **(fixed 2026-08-21 — Step 15)** Server-side appointment
      duration/slot validation. Previously `start`/`end` were trusted
      directly from the client with no duration or grid-alignment check.
      The server now always derives the authoritative end as
      `start + company.inspectionDurationMinutes` (client `end` is
      accepted for compatibility but never read) and rejects any
      duration mismatch (zero/negative/shortened/lengthened) or
      off-grid/off-hours start. Applies to both booking and reschedule.
      Verified in `src/lib/scheduling.test.ts` (6 new tests) and
      `e2e/booking-security.spec.ts` (route-level).
- [x] **(fixed 2026-08-21 — Step 15)** Inspector validation. A
      client-supplied `inspectorId` was previously accepted as an opaque,
      unchecked id. `POST /api/appointments` now looks it up scoped to
      the company and `active: true`; missing/inactive/cross-tenant ids
      are rejected with 400 `invalid_inspector`. Verified in
      `e2e/booking-security.spec.ts` against real inactive and
      cross-tenant fixture inspectors.
- [x] Reschedule (in place), cancellation, no-show, completed status
      transitions
- [x] Inspector field on Appointment (assignment architecture present; no
      auto-assignment logic yet — single default inspector seeded)
- [x] Full transition logic documented, including two inconsistencies
      worth resolving — `docs/STATES.md`
- [ ] Multi-inspector load balancing / assignment rules
- [ ] Per-inspector `AvailabilityRule` entity (today availability is
      company-wide, not per inspector)
- [x] **(fixed — Step 20)** Company-timezone and DST correctness.
      Central `src/lib/timezone.ts` uses validated IANA `Company.timezone`
      plus `@date-fns/tz`; slots, booking/reschedule validation, local-day
      capacity queries, dashboard today/week ranges, calendar grouping,
      and operational display all use the company calendar independent of
      host/browser timezone. Nonexistent spring times are omitted and the
      second fall-back occurrence is rejected. See `docs/TIMEZONE.md`.
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
- [x] Booking/reschedule/cancel/complete lifecycle events are written
      idempotently with their authoritative state transaction. No-show remains
      current-state only and is used for show-rate reporting.

## 10. Dashboard

- [x] Owner overview: inspections today/this week, new leads, MQL/SQL
      counts, completed inspections, won/lost, show rate, close rate
- [x] Funnel conversion/drop-off by stage
- [x] Mobile-responsive layout (Tailwind, tested at mobile viewport widths
      conceptually via responsive classes — not yet checked on a real
      device)
- [x] Calendar (day/week/month range views)
- [x] Source/medium/campaign/content performance UI with spend, all conversion
      stages, revenue, cost metrics, CAC, ROAS, and ROI

## 11. Attribution

- [x] Idempotent funnel event log (landing view → … → revenue recorded)
- [x] First-touch attribution persisted on Lead; per-event attribution
      column exists on FunnelEvent
- [x] Full event taxonomy and firing-site documentation — `docs/EVENTS.md`
- [x] Durable first- and last-touch visitor attribution; direct/internal returns
      do not erase a campaign, and server conversion events inherit the lead's
      authoritative last-touch snapshot

## 12. Analytics

- [x] Stage-to-stage conversion and drop-off calculation —
      `src/lib/analytics.ts`
- [x] Cost per lead / MQL / SQL / booked inspection / completed
      inspection — real, computed from entered `MarketingSpend`, never
      fabricated (shows "no data yet" otherwise)
- [x] Customer acquisition cost, return on ad spend (both null until real
      spend + outcome data exist)
- [x] Marketing spend entry UI (`/dashboard/marketing`)
- [x] Demo economics dashboard: lead→qualified and qualified→booked conversion,
      outcome-based show rate, inspection→customer close rate, cost per
      qualified lead, CAC, attributed contract value, ROAS, and ROI
- [x] Source/campaign performance UI with unique-Lead counts through qualified,
      booked, won, and contract-value stages
- [x] Company-timezone Today/7-day/30-day/custom date ranges and authoritative
      question-by-question reached/completed/abandoned reporting
- [x] Explicit demo-data mode and dashboard indicator; analytics queries never
      mix demo and production rows

## 13. Communications

- [x] **(implemented Step 24)** Provider-neutral production architecture:
      durable pre-send reservation/deduplication, explicit transactional vs
      marketing purpose, provider-account tenant mapping, authenticated and
      replay-bounded webhook adapter contract, idempotent delivery/inbound
      processing, channel-specific STOP/unsubscribe, lifecycle analytics
      events, and authenticated reminder/follow-up job entry point. See
      `docs/COMMUNICATIONS.md`.

- [x] Provider-abstraction interface with consent/opt-out gating
      (`src/lib/communications.ts`) — every send checked against consent
      before dispatch
- [x] Confirmation, reminder, reschedule, cancellation, and follow-up
      message templates
- [x] Deterministic development/test provider — no network I/O and no PII
      console logging; production rejects it
- [x] Durable communication lifecycle: blocked/suppressed/attempted/accepted/
      failed/delivered/bounced/received/opted-out states with distinct
      timestamps, provider correlation, pre-send database reservation, and
      authenticated webhook updates. Provider acceptance is never counted as
      delivery.
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
      writes to `SuppressionEntry`. Step 24 adds channel-specific opt-out
      timestamps and marketing-vs-transactional consent/suppression scope.
      No suppression-management UI or deliberate re-consent flow exists yet.
- [x] **(bug, audit — fixed 2026-08-20)** Cancellation messages now send
      consistently regardless of which UI path staff use (see Scheduling,
      milestone 7, for the fix)
- [x] Authenticated, idempotent job runner for 24-hour appointment reminders
      and qualified-not-booked follow-up; production still needs the host's
      scheduler configured
- [ ] Live email/SMS provider integration (deliberately deferred — no
      vendor chosen; see ARCHITECTURE.md)
- [ ] Configure a production scheduler to call the authenticated job endpoint

## 14. Settings

- [ ] Owner-facing UI to edit `Company` config currently only editable via
      seed/DB: service ZIP codes, supported pests, business hours,
      inspection duration/capacity, scoring rules, MQL/SQL thresholds,
      average contract value/commission assumptions
- [ ] Role-based access control tied to the `Settings` surface once it
      exists (pairs with milestone 3's authorization gap)

## 15. Testing

- [x] Unit tests: scoring, qualification/service-area,
      scheduling/double-booking/duration/slot-grid, attribution, analytics,
      communications consent gating, suppression
      normalization/tenant-scoping/shared-gate, communication delivery
      logging (blocked/sent/failed, tenant+lead scoping), funnel-ownership
      capability tokens (issuance/verification, production-secret
      fail-closed behavior, TTL/expiry, future-dated-token rejection),
      production-startup env validation, and centralized rate-policy/store/
      proxy-trust behavior, plus qualification schema/progression/company-
      eligibility behavior plus company-calendar/DST scheduling and
      reporting boundaries plus production environment/seed credential
      validation, bcrypt verification, and bounded serializable retry behavior
      (130 tests, `npm run test` —
      re-verified passing 2026-08-21)
- [x] End-to-end test of the full required journey — traffic → landing →
      funnel → lead → scoring → MQL/SQL → availability → booking →
      double-booking prevention → CRM/pipeline → inspection completed →
      customer won → dashboard/analytics update (`npx playwright test` —
      re-verified passing live, 2026-08-21)
- [x] **(added 2026-08-21 — Step 15, extended Step 17)** Adversarial
      end-to-end coverage of public-funnel security
      (`e2e/booking-security.spec.ts`, 13 scenarios): cross-visitor lead
      read/mutate rejected, **a caller supplying a victim's `visitorId`
      while omitting leadId/token cannot continue/mutate the victim's
      existing lead (the Step 17 continuation-bypass regression test)**,
      **a valid token for one lead cannot continue a different lead via
      `POST /api/leads`**, cross-visitor booking rejected, missing/
      malformed ownership tokens rejected, legitimate continuation/
      booking still works, two genuinely concurrent booking requests for
      the same slot never both succeed (`Promise.all`), real
      daily-capacity exhaustion is rejected, the server-derived
      appointment duration is used regardless of a malicious client
      `end`, off-hours/off-grid starts are rejected, inactive and
      cross-tenant inspectors are rejected. Run live against the real dev
      DB, re-run to confirm repeatability. Both the Step 15 and Step 17
      ownership fixes were sanity-checked by temporarily reverting each,
      confirming its test genuinely fails, then reverting the revert.
- [x] **(added 2026-08-21 — Step 18)** Real-route rate-limit coverage
      (`e2e/rate-limit.spec.ts`, 3 scenarios): normal lead/tracking/booking
      requests succeed; excessive traffic returns 429 + Retry-After;
      identifiers are isolated; and limited requests create no additional
      Lead, FunnelEvent, or Appointment row. Those protections remain green
      in the current 24/24 suite, including ownership, atomic booking,
      suppression, communication logging, and the full homeowner journey.
- [x] **(added — Step 19)** Real-route adversarial qualification coverage
      (`e2e/qualification-security.spec.ts`, 4 scenarios): unknown keys,
      invalid options/types, fake score/classification/status, required
      order, conditional switcher answers, supported-pest/service-area
      derivation, legitimate SQL and prospect outcomes, and availability/
      booking denial when persisted SQL is paired with incomplete answers.
      Full Playwright suite is now 24/24 passing.
- [x] **(added — Step 20)** Machine-timezone-independent timezone/DST unit
      coverage and live `e2e/timezone.spec.ts`: Central morning conversion,
      local-day UTC boundaries, post-midnight grouping/capacity, before/
      after-hours and closed-day booking rejection, spring gap, fall overlap,
      dashboard today/week, calendar grouping, and reschedule rejection.
      Full Playwright suite is now 25/25 passing.
- [x] **(added — Step 22)** PostgreSQL-specific integration/concurrency suite
      (`e2e/postgresql-concurrency.spec.ts`, 6 scenarios) verifies the partial
      index definition, simultaneous same-slot persisted count, concurrent
      different-slot daily capacity, concurrent reschedule rollback,
      cancel/reuse behavior, and two-company isolation against PostgreSQL
      17.11. The complete Playwright suite is 31/31 against PostgreSQL.
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
- [x] Type checking (`npx tsc --noEmit` — 0 errors, 2026-08-21)
- [x] Linting (`npm run lint` — 0 errors, 2026-08-21)
- [ ] Authorization/tenant-isolation tests (only one company exists
      currently, so cross-tenant isolation is architecturally present but
      not yet exercised by a test with two companies). Exception:
      `SuppressionEntry` company-scoping is unit-tested directly
      (`src/lib/suppression.test.ts`) since every query is asserted to
      include `companyId` — this covers the query-construction logic but is
      not a substitute for a real two-company end-to-end test.
- [ ] Component-level UI tests
- [ ] **(gap, audit)** Additional e2e scenarios still missing: lost
      outcome, no-show, second-company isolation. Reschedule (and
      concurrent/capacity booking races) are now covered as of Step 15 —
      see `e2e/communication-log.spec.ts` and `e2e/booking-security.spec.ts`.

## 16. Deployment

- [x] `npm run build` (production Next.js build) passes
- [ ] Dockerfile / hosting-specific deployment config
- [ ] Production environment variable documentation beyond `.env.example`
- [ ] Managed production PostgreSQL instance provisioned, backed up, pooled,
      monitored, and migrated (local PostgreSQL 17.11 architecture is verified)

## 17. Final integration

- [x] Realistic end-to-end scenario verified against the running app and
      real PostgreSQL database: attribution → qualification → lead scoring →
      MQL/SQL → availability → booking → double-booking prevention →
      calendar → CRM profile → pipeline stage → dashboard → funnel
      analytics → inspection completed → customer won → revenue/ROI
      update — all confirmed working together, not fabricated
- [x] Same scenario and PostgreSQL-specific concurrency suite re-verified
      against PostgreSQL 17.11 (Step 22)
- [ ] Highest-priority gaps from this review (suppression list,
      communication log, missing appointment-lifecycle events) closed
      before production launch, given the compliance boundaries in
      `docs/ARCHITECTURE.md`
