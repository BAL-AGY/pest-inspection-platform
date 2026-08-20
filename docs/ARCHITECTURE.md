# Architecture

Status: **Finalized for v1 build.** Changes to any decision below must be made
here first, with rationale, before code changes that contradict it.

2026-08-20 review note: the stack/data-model/compliance decisions below were
already implemented and finalized when this review ran. This pass verified
the actual implementation against the decisions recorded here, added the
System Architecture and Project Structure sections below, and produced three
companion docs with full detail: `docs/DATA_MODEL.md` (entity-by-entity
detail and where the schema simplifies vs. a maximal model),
`docs/EVENTS.md` (event taxonomy, exact firing sites, gaps against the
requested taxonomy), and `docs/STATES.md` (Lead/Appointment transition logic
as actually coded, including two inconsistencies worth knowing about). See
**Known gaps and near-term recommendations** near the end of this file for
the consolidated findings. No application code changed as part of this
review.

## Guiding principle

Every decision below is driven by the north star: **cost per qualified
booked inspection**. The system exists to move a homeowner from traffic
source to a kept, qualified Free Home Inspection appointment — not to sell
pest control online. Architecture choices favor a single deployable
application that can capture real leads, score them, book real appointments,
and report real numbers, over a polished-looking demo.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict mode) | Type safety across funnel logic, scoring, scheduling, and analytics that must be correct, not just look correct. |
| App framework | Next.js (App Router) | One codebase serves SEO-able public landing/funnel pages (SSR) and the authenticated owner dashboard (CSR/RSC), with API routes for the backend. Avoids standing up a separate frontend/backend deployment for v1. |
| Styling | Tailwind CSS | Fast, consistent, mobile-first by default — matches the mobile-first requirement for both the public funnel and the owner dashboard. |
| ORM | Prisma | Type-safe query layer, first-class migrations, straightforward multi-tenant modeling via a `companyId` column on tenant-scoped tables. |
| Database (dev/test, this environment) | SQLite | No local Postgres/Docker is available in this sandbox. SQLite lets the full stack — migrations, queries, tests — run and be verified for real, with no mocked persistence. |
| Database (production target) | PostgreSQL | Postgres is the intended production database (e.g. managed Postgres such as Neon/Supabase/RDS — no vendor selected/contracted). Prisma's `provider` is fixed per schema, so moving from SQLite to Postgres is a deliberate, documented cutover (swap `provider`, regenerate migrations against a real Postgres instance) before production deployment — not a runtime env toggle. Schema is written to stay portable: no SQLite-only or Postgres-only types, enums modeled as validated strings rather than native DB enums. |
| Auth | Auth.js (NextAuth) v5, credentials provider | Owner/staff login for the dashboard. No OAuth vendor assumed. Passwords hashed (bcrypt/argon2), sessions via database sessions (tenant + role on the session). |
| Validation | Zod | Shared validation for funnel input, API route input, and scoring/qualification rule definitions. |
| Communications (email/SMS) | Provider-abstraction interface with a console/log "dev" provider | Confirmation, reminder, and follow-up sends go through one interface (`sendEmail`, `sendSms`) so a real provider (e.g. an ESP, Twilio-compatible SMS API) can be plugged in via env config later without touching call sites. No live third-party credentials are assumed, configured, or fabricated. Every send path enforces consent/opt-out state before sending, and TCPA/CAN-SPAM-relevant fields (opt-in timestamp, opt-out status, quiet hours) are modeled from the start even before a real provider is wired in. |
| Testing | Vitest (unit/integration) + Playwright (end-to-end) | Vitest covers scoring, qualification, scheduling/double-booking, attribution, and analytics calculations as pure, deterministic logic. Playwright drives the actual browser through the full lead→inspection→outcome journey against the running app. |
| Deployment target | Node-compatible host running the Next.js production build (e.g. Vercel or a container) | No vendor contracted. `next build` / `next start` must pass; deployment config stays host-agnostic (env vars, no vendor-specific lock-in beyond what Next.js itself requires). |

## System architecture

### Frontend architecture

Single Next.js App Router tree serves two distinct surfaces from one
codebase: the public, SEO-relevant acquisition funnel (`src/app/page.tsx`,
`src/app/inspection/page.tsx`) rendered server-first, and the authenticated
owner dashboard (`src/app/dashboard/**`) which mixes server components for
data-heavy reads with small client islands for interactive forms
(status-change selects, marketing-spend entry). There is no separate SPA
build or separate dashboard deployment — one `next build` produces both.

### Backend architecture

No separate backend service. Next.js Route Handlers under `src/app/api/**`
are the entire backend, calling Prisma directly. Business logic that needs
to be correct independent of HTTP — scoring, qualification, scheduling,
attribution, analytics, communications consent — is factored into pure
functions in `src/lib/*.ts` that take/return plain data and never import
Prisma or Next request/response types, so they're unit-testable without a
server or database (`src/lib/*.test.ts`, run via Vitest). Route handlers are
thin: parse/validate with Zod, call the pure function, persist with Prisma,
respond. `src/lib/prisma.ts` is the single shared client (dev-mode global
singleton to survive Next.js hot-reload without exhausting connections).

### Database

SQLite for this environment's dev/test (no local Postgres available);
PostgreSQL is the recorded production target. See the Stack table above for
the full rationale and the deliberate-cutover plan. Full entity/relationship
detail: `docs/DATA_MODEL.md`.

### ORM

Prisma. Migrations live in `prisma/migrations/`; `prisma/seed.ts` seeds one
`Company` plus a default inspector for local/dev use.

### Authentication

Auth.js (NextAuth) v5, credentials provider, JWT session strategy
(`src/lib/auth.ts`). Passwords hashed with bcrypt. `companyId` and `role`
are embedded in the JWT/session via the `jwt`/`session` callbacks so every
authenticated request can resolve tenant + role without an extra DB round
trip.

### Authorization

Coarse-grained today: `src/lib/require-session.ts` resolves
`{ companyId, role, email }` or `null` for every protected route/page,
and every Prisma query in a protected route is scoped by that `companyId`
(never by a client-supplied tenant id). `role` (`owner | staff`) is carried
in the session but not yet used to gate any specific action — there is no
route or UI control today that behaves differently for `staff` vs `owner`.
That's an open item, not a security hole (both roles are staff of the same
single company in v1), but worth closing before a second `staff` account
with intentionally narrower access is created.

### API strategy

REST-ish Route Handlers, one per resource-ish concern
(`/api/leads`, `/api/leads/[id]`, `/api/appointments`,
`/api/appointments/[id]`, `/api/availability`, `/api/track`,
`/api/marketing-spend`, `/api/analytics/funnel`, `/api/dashboard/metrics`).
No GraphQL, no tRPC — deliberately, to keep the request/response shape
directly inspectable and avoid a second schema layer for a backend this
size. Every input is validated with Zod before touching Prisma.

### Server/client boundaries

Public funnel pages and dashboard read views are server components/route
handlers by default. Client components (`"use client"`) are used only
where interactivity requires it: the qualification funnel's step-by-step
UI, the visitor-id/attribution capture (`src/lib/visitor.ts`, which touches
`localStorage` and thus must run client-side), and dashboard forms/selects
that submit actions. No client component talks to Prisma directly — all
persistence goes through a route handler or a server action.

### Analytics / event tracking

Homegrown, not a third-party analytics vendor (consistent with "no
fabricated... third-party integrations" in Compliance boundaries — nothing
is silently phoning out to GA/Segment/etc.). Every trackable moment is a
row in the append-only `FunnelEvent` table, written either client-side via
`track()` → `POST /api/track` (fresh attribution resolved per hit) or
server-side inline in the route handler that caused the state change
(reuses the lead's stored first-touch attribution). Full taxonomy, firing
sites, and attribution-completeness caveats: `docs/EVENTS.md`. Funnel
conversion and cost-per-stage metrics are computed from this table by pure
functions in `src/lib/analytics.ts`, never fabricated — a stage with no
data renders as unavailable, not zero.

### Scheduling architecture

Pure, DB-free candidate-slot generation and conflict-checking in
`src/lib/scheduling.ts` (business hours × duration × existing bookings ×
daily capacity), wrapped by `POST /api/appointments` and
`GET /api/availability` for persistence. Double-booking is prevented twice:
an application-level overlap check before write, and a DB-level
`@@unique([inspectorId, scheduledStart])` constraint as the race guard,
both exercised in `e2e/full-funnel.spec.ts`. Full transition detail
(including two inconsistencies between the declared and actual appointment
states): `docs/STATES.md`.

### Messaging provider abstraction

`src/lib/communications.ts` defines a `CommunicationProvider` interface
(`send(message)`) with a swappable singleton (`getProvider`/`setProvider`)
and a console-logging dev implementation as the only one wired up today —
no live vendor is configured or assumed. `canSend()`/`sendIfConsented()`
remain the pure, per-lead consent/opt-out gate.

`src/lib/suppression.ts` (added 2026-08-20, Step 9) sits in front of that
gate as the actual call-site entry point: `sendIfAllowed()` checks the
durable, company-scoped `SuppressionEntry` table (normalized email/phone)
*before* falling through to `sendIfConsented()`, so a contact who opted out
stays suppressed even under a brand new `Lead`/`visitorId`, which
`Lead.optedOutAt` alone could not guarantee. Every send call site
(`POST /api/appointments`, the reschedule action in
`PATCH /api/appointments/[id]`, and `cancelAppointmentAndNotify()`) uses
`sendIfAllowed()`, not `sendIfConsented()` directly. `POST /api/leads` also
checks suppression at write time (via `suppressedChannels()`) so a
suppressed contact's `smsConsent`/`emailConsent` can't be reactivated by
resubmitting the funnel, and so `optedOutAt` is visible on the new Lead row
immediately rather than only surfacing the next time a send is attempted.
This module intentionally breaks from the "pure lib, no Prisma" convention
used by `communications.ts` itself — it's a persistence-backed orchestration
layer, the same category as `appointment-actions.ts`, not business logic
that needs to run without a database. `src/lib/suppression.test.ts` unit
tests normalization and the gate's control flow with a mocked Prisma client;
`e2e/suppression.spec.ts` exercises the real persistence path against the
dev DB. **Known limitation, deliberately not addressed by this change**:
the current system has no marketing-vs-transactional message distinction —
every send, including booking confirmations and reschedule/cancellation
notices, is gated identically — so suppression blocks all of them
uniformly, matching pre-existing `canSend` behavior. A transactional-bypass
would be a real product decision, not a data-model gap, and wasn't asked
for.

**Communication delivery log (added 2026-08-20, Step 11)**:
`sendIfAllowed()` now also persists one `Communication` row per send
attempt via `src/lib/communication-log.ts`'s `logCommunication()` — the
gap flagged directly above and in `docs/GOAL_AUDIT.md` Critical Path item
4. Precision matters here: `status: "sent"` means the provider *accepted*
the message, not that it reached the homeowner. `status: "blocked"` covers
both suppression and missing/absent consent (`blockedReason` records
which); `status: "failed"` covers both a thrown provider exception and a
provider that resolves `{ sent: false }` without throwing. `"queued"` (for
a future async/queued provider) and `"delivered"`/`"bounced"`/
`"undeliverable"` (for a future delivery-status webhook) are declared in
`COMMUNICATION_STATUSES` (`src/lib/pipeline.ts`) but never written today —
see CLAUDE.md's "never fabricate third-party integration data." Logging
lives entirely inside `sendIfAllowed`, so booking, reschedule, and
cancellation call sites needed no independent logging logic of their own —
they only had to start passing `leadId`/`appointmentId`/`type` through the
existing call. A logging write failure is caught and reported to console
rather than propagated, so a logging outage can never block a real send
attempt. Tenant/lead scoping matches every other table (`companyId`/
`leadId` on every row, asserted directly in
`src/lib/suppression.test.ts`). Queryable today via `GET /api/leads/[id]`
(`lead.communications`); no CRM UI renders it yet — out of scope for this
fix.

### Attribution architecture

First-touch UTM/click-id parsing (`src/lib/attribution.ts`) resolved at
the landing page and persisted once on `Lead` (`source/medium/campaign/
content/term/landingPage/clickId`), never overwritten on subsequent visits
by the same lead. `FunnelEvent` rows carry the same columns, but — see
`docs/EVENTS.md` — only the two client-fired event types currently get
attribution resolved fresh per event; the rest inherit the lead's
first-touch values or carry none. Cost-per-lead/MQL/SQL/booked/CAC/ROAS
are computed by matching `MarketingSpend.source`/`campaign` strings against
lead/event attribution, never fabricated when spend data is absent.

### Deployment strategy

See the Stack table above (Node-compatible host running `next build`/
`next start`; no vendor contracted). No Dockerfile or hosting-specific
config exists yet in this repo — see TASKS.md's Deployment milestone.

## Project structure

```
prisma/
  schema.prisma        Data model (see docs/DATA_MODEL.md)
  migrations/           Generated migrations
  seed.ts               Seeds one Company + default Inspector for local/dev

src/
  app/
    page.tsx             Public landing page ("/")
    inspection/page.tsx  Qualification funnel + booking flow
    login/page.tsx        Staff login
    layout.tsx, globals.css
    dashboard/
      layout.tsx
      page.tsx                Owner overview (funnel counts, cost metrics)
      leads/page.tsx          Pipeline board
      leads/[id]/page.tsx     Lead detail: profile, notes, timeline, status/outcome override, appointment actions
      calendar/page.tsx       Day/week/month appointment views
      marketing/page.tsx      Marketing-spend entry
    api/
      leads/route.ts                  Qualification/contact upsert (public), lead list (staff)
      leads/[id]/route.ts             Lead detail (staff), status/outcome override
      leads/[id]/notes/route.ts       Add note
      appointments/route.ts           Book (public-eligible via SQL gate), list (staff)
      appointments/[id]/route.ts      Reschedule/cancel/no-show/complete
      availability/route.ts           Candidate slot list for an SQL lead
      track/route.ts                  Funnel event ingestion
      marketing-spend/route.ts        Spend entry
      analytics/funnel/route.ts       Funnel conversion API
      dashboard/metrics/route.ts      Dashboard metrics API
      auth/[...nextauth]/route.ts     Auth.js handlers
  lib/
    prisma.ts             Shared Prisma client
    auth.ts                Auth.js config
    require-session.ts     Session → {companyId, role} resolver
    company.ts              Active-company resolver + JSON-config parsers
    pipeline.ts              Canonical status/event-type string unions (single source of truth)
    qualification.ts         Question set, next-question logic, service-area check
    scoring.ts                Configurable scoring rules, classification
    scheduling.ts             Slot generation, conflict/capacity checks
    attribution.ts             UTM/click-id/referrer parsing
    visitor.ts                 Client-side visitor/lead id + track() helper
    communications.ts          Provider abstraction, consent gate, templates
    suppression.ts                Durable cross-lead suppression + shared send gate
    communication-log.ts           Persists a Communication row per send attempt
    analytics.ts                 Pure funnel/cost/CAC/ROAS calculations
    dashboard-metrics.ts          Prisma-backed aggregation using analytics.ts
    *.test.ts                     Vitest unit tests, one per lib module above

e2e/
  full-funnel.spec.ts    Playwright: traffic → funnel → lead → scoring →
                           booking → double-booking prevention → CRM →
                           completion → won → dashboard
  suppression.spec.ts    Playwright: opt-out persists across a brand new
                           Lead/visitorId, unrelated contact unaffected
  communication-log.spec.ts  Playwright: booking/reschedule/cancel each
                           persist a communication record; a suppressed
                           contact's send is persisted as blocked

docs/
  ARCHITECTURE.md   This file — stack + system architecture decision record
  DATA_MODEL.md      Entity-by-entity detail and simplification rationale
  EVENTS.md            Event taxonomy and firing sites
  STATES.md             Lead/Appointment transition logic as implemented
```

## Multi-tenancy

Single company is deployed for v1, but every tenant-owned table carries a
`companyId` from day one and all queries are scoped by it. No cross-tenant
sharing, no premature tenant-admin UI, no billing/plan system — just a data
model that will not need a breaking migration to onboard a second company.

## Data model (high level)

Full entity-by-entity detail, relationships, and the rationale for every
place this schema simplifies a maximal entity list into fewer tables:
`docs/DATA_MODEL.md`. Summary:

- `Company` — the pest control business (branding, service area, business
  hours, scoring config, cost assumptions).
- `User` — staff/owner accounts (role-based: owner, staff).
- `Lead` — the prospect/CRM record: contact info, property info, pest
  concern, existing-provider/switcher fields, qualification answers, score,
  classification (MQL/SQL), pipeline status, source/campaign attribution,
  timestamps.
- `FunnelEvent` — append-only event log per visitor/lead
  (visit → assessment start → contact captured → lead → MQL → SQL →
  scheduler viewed → appointment booked → appointment completed →
  won/lost), the source of truth for funnel/attribution analytics.
- `Inspector` — who can be assigned to inspections.
- `Appointment` — inspection booking: lead, inspector, time slot, status
  (booked/rescheduled/cancelled/no-show/completed), tied to availability
  rules (business hours, duration, capacity, service area).
- `MarketingSpend` — company-entered spend by source/campaign/period, used
  for cost-per-lead/MQL/SQL/booked/CAC calculations. Numbers are computed
  from entered data only; nothing is fabricated when spend/revenue data is
  absent (dashboard shows "no data yet," not invented figures).
- `AuditLog` — records important state changes (status transitions,
  scoring-rule changes, user actions).
- `SuppressionEntry` — durable, company-scoped opt-out list keyed by
  normalized email/phone, independent of any one Lead row.
- `Communication` — one row per outbound send attempt (email/sms
  confirmation, reschedule, cancellation), recording whether it was
  blocked, sent (provider-accepted), or failed — never fabricated as
  "delivered."

## Qualification, scoring, and scheduling as pure logic

Lead scoring, MQL/SQL classification, service-area validation, and
appointment-availability/double-booking logic are implemented as pure,
independently testable functions operating on plain data — not buried in UI
components or route handlers — so they can be unit tested directly and
reused between the public funnel, the CRM, and the dashboard.

## Known gaps and near-term recommendations

Consolidated from this review's read of `docs/DATA_MODEL.md`,
`docs/EVENTS.md`, and `docs/STATES.md`. None of these are implemented as
part of this review — design/documentation only. Ordered roughly by
priority:

1. ~~**No suppression list.**~~ **Fixed 2026-08-20 (Step 9).** Durable,
   company-scoped `SuppressionEntry` table, checked by the shared send gate
   and by lead creation — see the Messaging provider abstraction section
   above and `docs/DATA_MODEL.md` **SuppressionEntry**.
2. ~~**No Communication log.**~~ **Fixed 2026-08-20 (Step 11).** Every
   send attempt through the shared gate now persists a `Communication`
   row — see the Messaging provider abstraction section above and
   `docs/DATA_MODEL.md` **Communication**.
3. **Three appointment-lifecycle events are missing from the funnel log**
   (reschedule, cancel, no-show) — `Appointment.status` itself is correct,
   but these transitions are invisible to funnel/attribution analytics.
   → `docs/EVENTS.md`.
4. **Attribution on most events is first-touch-inherited, not fresh** —
   true multi-touch/last-touch attribution isn't derivable from the event
   log today, only first-touch (which is reliable). → `docs/EVENTS.md`
   **Attribution completeness**.
5. **`Appointment.status = "rescheduled"` is declared but never set**
   (reschedule happens in-place); `rescheduledFromId` is similarly unused.
   Either drop both or actually use them. → `docs/STATES.md`.
6. **No lead-score history/audit trail** — score/classification changes
   aren't written to `AuditLog`, unlike status changes. → `docs/DATA_MODEL.md`
   **LeadScore**.
7. **No server-side Lead status transition guard** — manual overrides can
   set any status from any status; may be intentional but should be a
   documented choice. → `docs/STATES.md`.
8. **`role` is carried but not enforced** — `owner` vs `staff` doesn't
   currently gate any route or UI differently.
9. **Instrumentation gaps against the requested event taxonomy**:
   `cta_clicked` and `assessment_step_completed` are not implemented, so
   CTA effectiveness and in-funnel step drop-off aren't measurable yet.
   → `docs/EVENTS.md`.

None of these block the platform from functioning end-to-end (TASKS.md's
verified-working claims stand); they're the gaps between "works" and
"complete/auditable/compliant at scale."

## Compliance boundaries

- No functionality advises or facilitates violating an existing provider's
  contract.
- No outbound communication bypasses consent/opt-out, do-not-call, TCPA, or
  CAN-SPAM requirements; consent and opt-out state are first-class fields.
- No fabricated analytics, reviews, customers, appointments, revenue, or
  third-party integrations. Metrics reflect real stored data or explicitly
  show as unavailable.
