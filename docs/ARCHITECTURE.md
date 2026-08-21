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
| Database (dev/test/production) | PostgreSQL | PostgreSQL 17.11 is verified locally for fresh migrations, the full application suite, and real concurrent booking/reschedule races. One database engine across environments avoids provider-specific migration and transaction drift. No managed production vendor is selected yet. See `docs/POSTGRESQL.md`. |
| Auth | Auth.js (NextAuth) v5, credentials provider | Owner/staff login for the dashboard. No OAuth vendor assumed. Passwords hashed (bcrypt/argon2), sessions via database sessions (tenant + role on the session). |
| Validation | Zod | Shared validation for funnel input, API route input, and scoring/qualification rule definitions. |
| Communications (email/SMS) | Provider-neutral outbound + inbound adapters; deterministic test adapter only | PostgreSQL reserves idempotent sends before provider calls, provider webhooks own signature verification, and tenant mapping/status/STOP processing are centralized. No live vendor or credential is fabricated. See `docs/COMMUNICATIONS.md`. |
| Testing | Vitest (unit/integration) + Playwright (end-to-end) | Vitest covers scoring, qualification, scheduling/double-booking, attribution, and analytics calculations as pure, deterministic logic. Playwright drives the actual browser through the full lead→inspection→outcome journey against the running app. |
| Deployment target | Paid Render Node web service + managed PostgreSQL + managed Redis-compatible Key Value + cron (recommended, not provisioned) | Simplest single-platform pilot fit for long-lived Node, Prisma serializable transactions, shared rate limits, webhooks and scheduled jobs. Portable CI/health code is implemented; no vendor account or resource exists. See `docs/DEPLOYMENT.md`. |

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

PostgreSQL for development, integration tests, and production. The prior SQLite
migration history is archived under `prisma/migrations-sqlite/`; active
PostgreSQL migrations live under `prisma/migrations/`. Absolute timestamps use
`TIMESTAMPTZ(3)`. Full operational guidance is in `docs/POSTGRESQL.md`; entity/
relationship detail is in `docs/DATA_MODEL.md`.

### ORM

Prisma with PostgreSQL-native migrations in `prisma/migrations/`.
`prisma/seed.ts` seeds one `Company` plus a default inspector for local/dev use.

### Authentication

Auth.js (NextAuth) v5, credentials provider, JWT session strategy
(`src/lib/auth.ts`). Passwords hashed with bcrypt. `companyId` and `role`
are embedded in the JWT/session via the `jwt`/`session` callbacks so every
authenticated request can resolve tenant + role without an extra DB round
trip.

Production security configuration is centralized in
`src/lib/environment.ts`. Node startup instrumentation and the auth,
funnel-capability, and rate-limiter runtime paths reject missing, weak,
placeholder, or reused `AUTH_SECRET`, `FUNNEL_CAPABILITY_SECRET`, and
`RATE_LIMIT_IDENTIFIER_SECRET` values. Each secret is a separate trust domain;
none may fall back to another in production. Development/test remain
deliberately ergonomic. Production owner provisioning is an explicit seed
operation with mandatory safe credentials; it never logs a password or resets
an existing hash. See `docs/PRODUCTION_SETUP.md`.

Deployed staging uses `NODE_ENV=production` with the separate, explicit
`DEPLOYMENT_ENV=staging` boundary. This preserves production secret,
PostgreSQL, and Redis checks while allowing only the deterministic no-network
communications adapter. Production is the fail-safe default and rejects that
adapter. See `docs/STAGING.md`.

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

### Public API abuse protection

Public route handlers use the centralized limiter in
`src/lib/rate-limit.ts`; the complete endpoint inventory and policies are
in `docs/ENDPOINT_SECURITY.md`. Enforcement stays in route handlers rather
than Next.js Proxy because lead/booking policies need parsed,
capability-verified identifiers, and Proxy code must not rely on shared
globals. Policies differ for lead creation, continuation, tracking,
availability, booking, and authentication.

Identifiers are HMAC-hashed before storage. `X-Forwarded-For` is ignored
unless the operator explicitly configures the verified trusted-proxy hop
count. Limited requests receive `429` plus `Retry-After` before any
state-changing database operation. Booking transactions and the active-slot
unique index remain authoritative; throttling is only an abuse-control layer.

Production uses `RedisRateLimitStore` through the same `RateLimitStore` seam.
An atomic Lua increment/expiry operation and Redis server time make each bucket
consistent across replicas. `REDIS_URL` is mandatory in production; a backend
failure returns 503 and never falls back to an unlimited or process-local path.
`InMemoryRateLimitStore` remains only for local/test use without Redis. Redis
operations and multi-instance enforcement are covered by a real Redis
integration suite; deployment still owns Redis HA, monitoring, TLS, and
eviction/capacity configuration.

### Server-authoritative qualification

`src/lib/qualification.ts` is the single definition and validation boundary
for public qualification answers. It owns question IDs, types, required and
conditional behavior, allowed option values, ZIP validation, ordered
progression, and company-specific service-area/supported-pest derivation. The
interactive client renders the same definitions, but its local progression
and classification are never authorization signals.

`POST /api/leads` accepts at most the next visible answer per request (plus
unchanged cumulative prior answers for UI compatibility), rejects attempts to
change multiple steps at once, safely revalidates downstream state after a
single-answer correction, sanitizes persisted legacy JSON, derives internal
scoring facts, and computes score/classification server-side. Incomplete
questionnaires remain `prospect` regardless of favorable partial answers.
`GET /api/availability` and `POST /api/appointments` independently rebuild
qualification state from stored answers and current Company configuration;
they require a complete questionnaire, contact capture, homeowner status,
service-area membership, supported pest, and SQL classification. Full rules
and response behavior are documented in `docs/QUALIFICATION.md`.

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
row in `FunnelEvent`, written through the centralized idempotent writer.
`POST /api/track` is restricted to four non-authoritative browser interaction
events and cannot forge qualification, booking, customer, or revenue outcomes;
server conversions are written beside their authoritative state mutation.
Full taxonomy: `docs/EVENTS.md`. Unique visitors/leads drive funnel counts,
company-local date boundaries drive ranges, and unavailable spend/revenue stays
unavailable rather than being fabricated. See `docs/ANALYTICS.md`.

### Scheduling architecture

Pure, DB-free candidate-slot generation and conflict-checking in
`src/lib/scheduling.ts` (business hours × duration × existing bookings ×
daily capacity), wrapped by `POST /api/appointments`,
`PATCH /api/appointments/[id]` (`action: "reschedule"`), and
`GET /api/availability` for persistence. Full transition detail (including
two inconsistencies between the declared and actual appointment states):
`docs/STATES.md`.

**Company calendar and DST (Step 20).** `Company.timezone` is the
authoritative validated IANA zone. `src/lib/timezone.ts`, backed by the
date-fns v4 companion `@date-fns/tz`, converts company-local dates and wall
times to UTC instants and creates local day/week query ranges. Slots are
enumerated on the local wall-clock grid and stored as UTC instants. DST-gap
times fail round-trip validation and are omitted; a fall-back wall time has
one canonical first occurrence and the repeated second occurrence is rejected,
so capacity cannot be duplicated. Booking and reschedule query the requested
appointment's company-local `[midnight, next midnight)` range, which naturally
spans 23 or 25 hours. Dashboard today/week and calendar grouping use the same
helpers. See `docs/TIMEZONE.md`.

**Concurrency and validation rework (Steps 15 and 22).** An
independent audit (Codex) flagged, and direct code inspection confirmed,
that the previous double-booking guard didn't actually work, and that
appointment timing wasn't validated server-side at all. Both are fixed:

- **Atomic double-booking guard.** The DB-level guard used to be
  `@@unique([inspectorId, scheduledStart])`. This provided *no real
  protection*: every booking has `inspectorId = null` (no per-inspector
  calendars exist — see Inspector below), and SQL unique indexes treat
  NULLs as distinct, so multiple null-inspector rows at the identical
  `scheduledStart` never violated it. Double-booking prevention rested
  entirely on a non-atomic check-then-insert read in the route handler,
  which a genuinely concurrent request could beat. It is now a **partial
  unique index** on `(companyId, scheduledStart)`, filtered to
  `status IN ('booked', 'rescheduled')`, added by raw SQL in the PostgreSQL
  baseline migration (Prisma's schema DSL has no
  filtered/partial-index construct, so it's not a `@@unique` in
  `prisma/schema.prisma` — see that model's comment). Scoped by
  `companyId` rather than `inspectorId` to match the app's actual
  single-shared-calendar model (the overlap check in
  `assertSlotBookable` is already company-wide, not per-inspector);
  filtered to active statuses so a cancelled appointment doesn't
  permanently block re-booking that slot. **Verified against PostgreSQL
  17.11**: `e2e/postgresql-concurrency.spec.ts` fires simultaneous route
  requests, asserts one 200/one 409, and confirms exactly one active row;
  cancel-then-rebook at the identical instant also succeeds.
- **Serializable transaction + bounded retry.** Both booking and
  reschedule now re-run `assertSlotBookable` a second time *inside* the
  `$transaction`, immediately before the write, using
  `Prisma.TransactionIsolationLevel.Serializable`. This closes almost all
  of the TOCTOU window for both the same-slot race (also closed
  atomically by the partial index above, independent of isolation level)
  and the **daily-capacity race** (two concurrent bookings at *different*
  times on a day already at `maxDailyInspections - 1`, which the partial
  unique index does not cover — capacity is a per-day count invariant,
  not a per-row uniqueness invariant). Step 22 wraps those transactions in
  `runSerializableTransaction()`, which retries only Prisma `P2034` at most
  three times and reruns the complete capacity read/check/write. The real
  PostgreSQL suite starts at `capacity - 1`, submits two concurrent bookings
  for different valid times, and proves one succeeds, one returns 409, and the
  persisted company-local-day count equals capacity. Concurrent reschedules
  have the same proof; the failed move preserves its source appointment. The
  guarantee is database-backed across application instances. See
  `docs/POSTGRESQL.md`.
- **Server-derived, authoritative appointment timing.** `start`/`end`
  used to be trusted directly from the client on both booking and
  reschedule. The server now always derives the authoritative end as
  `start + company.inspectionDurationMinutes`, ignoring any client-
  supplied `end` entirely (it's still accepted in the request schema for
  backward/display compatibility, just never read). `assertSlotBookable`
  additionally rejects any `requested` range whose duration doesn't
  exactly equal the company's configured duration (closing zero/negative/
  shortened/lengthened appointments) and any `start` that doesn't align
  to the exact slot grid `generateCandidateSlots` would produce (business
  hours open time + a whole number of duration increments) — closing
  "arbitrary" times a client fabricates outside the real bookable grid.
- **Inspector validation.** A client-supplied `inspectorId` is now looked
  up scoped to the resolved company and `active: true` before use;
  missing/inactive/cross-tenant ids are rejected with 400
  `invalid_inspector`. Previously accepted as an opaque, unchecked id.

See `e2e/booking-security.spec.ts` for the adversarial route-level proof
of all of the above (not just the underlying pure functions, which
`src/lib/scheduling.test.ts` covers separately).

### Public funnel ownership (IDOR fix, 2026-08-21 Step 15; continuation-bypass + secret/lifetime hardening, 2026-08-21 Step 17)

**Step 15.** An independent audit found that every public, unauthenticated
`leadId`-scoped route (`POST /api/leads` continuation, `POST
/api/appointments`, `GET /api/availability`) trusted a bare `leadId` as
proof of ownership — confirmed by direct inspection: the lookup was
scoped by `{ id: leadId, companyId }` with no check that the caller was
the visitor who created that lead. Anyone who obtained a lead's id (a
log, a shared device, or the fact that `GET /api/availability?leadId=`
put it in the URL/browser history) could rewrite that lead's contact info
and consent, or book/consume its inspection slot. Fixed with
`src/lib/funnel-capability.ts`: an HMAC-signed capability token, derived
from the lead's *actual, server-side* `visitorId` (never the caller's
claimed one), required on every subsequent request that references a
`leadId` (`leadToken` in the JSON body for `POST /api/leads` and `POST
/api/appointments`; an `X-Funnel-Token` header, not a query param, for
`GET /api/availability`, so it doesn't leak into browser history/access
logs the way `leadId` itself already does). A missing or wrong token is
rejected as 403 `forbidden`.

**Step 17 — continuation bypass, found by a second independent review of
the Step 15 work.** `POST /api/leads`' "no `leadId` supplied" branch
still looked up **any existing lead by `visitorId` alone**
(`prisma.lead.findFirst({ where: { companyId, visitorId } })`) with *no
token check at all* — a caller who knew or supplied a victim's
`visitorId` could omit `leadId` entirely, and the server would find,
mutate, and hand back a **fresh, valid token for the victim's own lead**.
This meant the IDOR was only partially closed: a leaked `leadId` alone no
longer worked, but a leaked/guessed `visitorId` alone still did, and
compounded the exposure by minting the attacker a working credential
afterward. Root cause: that branch was written to resolve "is there
already a lead for this visitor" without distinguishing *true first-time
creation* (nothing to protect yet — safe to trust `visitorId`) from
*continuing a lead that already exists* (must be authenticated the same
way the `leadId` branch already is).

**Fix**: when `leadId` is omitted, the request is now *unconditionally*
treated as "create a new lead" — `existing` is never populated from a
`visitorId`-only lookup, regardless of whether a prior lead already
exists for that visitor. Continuing an existing lead always requires
`leadId` + a valid `leadToken`; there is no other path. A forged
`visitorId` matching a real victim now just creates a second, harmless,
unrelated `Lead` row (nothing enforces `visitorId` uniqueness, and
nothing downstream assumes one visitor maps to at most one lead) — it can
no longer read, mutate, or obtain a working token for the victim's actual
lead. The one accepted trade-off: a genuine first-question double-submit
(e.g. a network retry before the client has received `leadId` back) now
creates two `Lead` rows instead of being silently deduplicated by the old
`visitorId` lookup. This is a data-quality nicety, not a security
property, and real idempotency (e.g. a client-supplied idempotency key)
is the correct later fix if it proves to matter in practice — not
implemented here to keep this change scoped to the security fix.
`e2e/booking-security.spec.ts` proves the exact exploit fails (sanity-
checked by temporarily reverting the fix and confirming the test
genuinely fails, then re-applying it).

**Production secret behavior (Steps 17 and 21).** `getSecret()` in
`src/lib/funnel-capability.ts` now fails closed: in production
(`NODE_ENV=production`) `FUNNEL_CAPABILITY_SECRET` is required with **no
fallback whatsoever** — reusing `AUTH_SECRET` is dev/test-only
convenience, gated strictly to non-production, because (a) it would
couple two unrelated trust domains (staff session signing vs. anonymous
funnel ownership — rotating one would unintentionally affect the other)
and (b) it risks a well-known development placeholder value reaching
production undetected. This is enforced twice: at every request
(`getSecret()` throws before any token is issued/verified) and at process
startup, via `src/instrumentation.ts`'s `register()` hook (Next.js's
[instrumentation](https://nextjs.org/docs/app/guides/instrumentation)
convention — runs once when the server boots, before any request is
served), which throws immediately if `FUNNEL_CAPABILITY_SECRET` is unset
in production. The startup check exists so a misconfigured production
deploy fails at boot/health-check time, not silently on the first real
homeowner's request. The secret is never logged (thrown errors describe
*that* it's missing, never echo any secret value) and is never imported
from client code — `funnel-capability.ts` is documented server-only and
is only ever imported from `src/app/api/**` route handlers; Next.js also
never bundles non-`NEXT_PUBLIC_`-prefixed env vars into client JS as a
structural backstop.

Step 21 generalized this into `src/lib/environment.ts`: `AUTH_SECRET`,
`FUNNEL_CAPABILITY_SECRET`, and `RATE_LIMIT_IDENTIFIER_SECRET` are all required
in production, must be at least 32 characters, must not be a known/example
placeholder, and must be pairwise distinct. Instrumentation calls the central
validator at startup; security-sensitive runtime paths call it again as defense
in depth. Production seeding likewise refuses deterministic development owner
credentials and requires explicit safe values. Full operator requirements are
in `docs/PRODUCTION_SETUP.md`.

**Token lifetime and storage (Step 17).** Tokens are no longer purely
deterministic — they now embed a plaintext-but-HMAC-covered `issuedAt`
timestamp (`{issuedAtMs}.{signature}`) and are rejected once older than
`LEAD_TOKEN_TTL_MS` (4 hours) or if the timestamp claims to be in the
future (tamper detection). Every successful lead-scoped response
re-issues a fresh token, so an actively continuing visitor never
approaches the limit in practice — the TTL only bounds how long a token
that leaked some other way (logs, a shared device, an XSS bug elsewhere
on the page) remains replayable after the fact. **Known, deliberately
undeferred limitation**: the client still stores this token in
`localStorage` (`src/lib/visitor.ts`), which does not meaningfully
protect against an *active* XSS attacker — such an attacker can issue
authenticated requests directly from injected JS without ever needing to
read the token value first, and TTL doesn't change that. What TTL +
localStorage together provide is a bounded (not indefinite) window for a
token that leaked *outside* an active XSS session. The correct stronger
fix — not implemented in this pass, to avoid redesigning the funnel's
request/response contract in the same change that fixed the IDOR,
continuation bypass, and concurrency/duration bugs — is an `httpOnly`,
`Secure`, `SameSite=Lax` cookie set by the server, which at minimum
prevents *exfiltrating* the token for reuse outside the compromised
page/session; it would also need CSRF-aware design, since cookies are
attached automatically by the browser (unlike the current explicit
header/body token, which an XSS-driven same-origin fetch could read from
`localStorage` and use identically to a stolen cookie's in-session
abuse-case, but which a cross-origin CSRF attempt cannot forge without
XSS). This is flagged as the recommended next step, not implemented here.

Deliberately **not** protected by any of this: `POST /api/track`
(fire-and-forget client-side analytics event ingestion). It accepts an
optional `leadId` too, but only ever *writes* an informational
`FunnelEvent` row referencing it — it never reads or mutates lead data
back to the caller, so the worst case of a forged `leadId` there is
analytics pollution, not a confidentiality/integrity breach. Out of scope
for this fix; flagged here so it isn't mistaken for an oversight.

Authenticated staff routes (everything under `requireSession()`) were
never affected by any of this and are untouched — they already scope
every query by `session.companyId` from the JWT, independent of any
client-supplied id.

A full re-audit of every route accepting `leadId`, `visitorId`,
`companyId`, or a funnel token (Step 17) found no other instance of this
bypass pattern: `POST /api/appointments` and `GET /api/availability`
both *require* `leadId` (no visitorId-fallback branch exists in either),
and `companyId` is never client-supplied anywhere in the public routes
(always resolved via `getActiveCompany()`) or the staff routes (always
`session.companyId`).

### Messaging provider abstraction

**Step 24 supersedes the historical description below.** The original console
provider/post-send log has been replaced by a no-network deterministic adapter,
durable pre-send reservation, explicit purpose/direction/status timestamps,
provider-account tenant mapping, authenticated/idempotent inbound webhooks, and
an authenticated reminder/follow-up job runner. Production rejects the test
adapter and currently supports only `COMMUNICATION_PROVIDER=disabled`. The
authoritative design is `docs/COMMUNICATIONS.md`.

`src/lib/communications.ts` owns pure consent/provider contracts;
`src/lib/suppression.ts` is the persistence-backed outbound gate;
`src/lib/communication-webhooks.ts` owns verified inbound/status processing;
and `src/lib/communication-jobs.ts` selects due reminders/follow-up. Every
call site uses the same durable gate. Suppression and consent are evaluated by
channel and purpose, a database reservation precedes provider I/O, and only an
authenticated provider event can mark a message delivered. Communication rows
remain queryable through `GET /api/leads/[id]`; the CRM does not render the
timeline yet.

### Attribution architecture

UTM/click-id/referrer parsing (`src/lib/attribution.ts`) feeds a durable
`VisitorAttribution` first/last-touch record. First touch is immutable; a later
campaign/click/external referral updates last touch, while direct/internal
navigation does not erase it. Both snapshots persist on the Lead and server
conversion events inherit last touch. `MarketingSpend` and event reporting use
source/medium/campaign/content dimensions; costs, CAC, ROAS and ROI remain null
when required real spend/revenue is absent. See `docs/ANALYTICS.md`.

### Deployment strategy

The recommended pilot topology and alternatives are in `docs/DEPLOYMENT.md`.
Provider-neutral GitHub Actions CI uses disposable PostgreSQL and Redis, and
the application exposes separate liveness and dependency readiness routes.
Production startup validates PostgreSQL/Redis URLs and independent secrets.
No provider resource, deployment credential, Dockerfile, or auto-deploy workflow
is committed; selecting and creating the external account remains an explicit
operator decision. Operational alerts, backup/restore targets and incident
behavior are defined in `docs/OPERATIONS.md`.

## Project structure

```
prisma/
  schema.prisma        PostgreSQL data model (see docs/DATA_MODEL.md)
  migrations/           Active PostgreSQL migration history
  migrations-sqlite/    Archived pre-cutover SQLite history (never deployed)
  seed.ts               Seeds one Company + default Inspector for local/dev

src/
  instrumentation.ts    Startup hook — fails fast in production if
                          FUNNEL_CAPABILITY_SECRET is unset
  instrumentation.test.ts  Vitest coverage for the above
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
    qualification.ts         Authoritative questions, validation, progression, eligibility
    scoring.ts                Configurable scoring rules, classification
    scheduling.ts             Slot generation, conflict/capacity/duration checks
    serializable-transaction.ts  Bounded PostgreSQL P2034 retry wrapper
    timezone.ts               IANA-zone conversion, DST, local day/week ranges
    funnel-capability.ts        Public lead-ownership HMAC capability tokens
                                  (production-gated secret, TTL/expiry)
    attribution.ts             UTM/click-id/referrer parsing
    visitor.ts                 Client-side visitor/lead id/token + track() helper
    communications.ts          Provider abstraction, consent gate, templates
    suppression.ts                Durable cross-lead suppression + shared send gate
    communication-webhooks.ts       Verified/idempotent inbound + status processing
    communication-jobs.ts           Reminder and qualified-follow-up selection
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
  booking-security.spec.ts  Playwright: IDOR/ownership adversarial tests,
                           genuinely concurrent double-booking, capacity
                           exhaustion, duration/slot/inspector validation
  postgresql-concurrency.spec.ts  Real PostgreSQL index, simultaneous booking,
                           daily capacity, reschedule, cancel, and tenant proofs

docs/
  ARCHITECTURE.md   This file — stack + system architecture decision record
  DATA_MODEL.md      Entity-by-entity detail and simplification rationale
  EVENTS.md            Event taxonomy and firing sites
  STATES.md             Lead/Appointment transition logic as implemented
  POSTGRESQL.md         Migration, concurrency, retry, and operations guide
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
- `FunnelEvent` — tenant-scoped, idempotent event log from landing through
  qualification, booking lifecycle, customer outcome, and real revenue; the
  source of truth for funnel/attribution analytics.
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
3. Reschedule, cancel, and complete are now transactional funnel events;
   no-show remains current-state-only and is included in show-rate reporting.
4. First and last attribution are durable; the dashboard currently uses
   event/last-touch attribution and does not yet offer a model selector.
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
10. ~~**Public `leadId`-scoped routes had no ownership check (IDOR).**~~
    **Fixed 2026-08-21 (Step 15), with a continuation-bypass gap found by
    a second independent review and fixed the same day (Step 17).** The
    Step 15 fix closed the `leadId`-alone bypass but left a second one:
    `POST /api/leads`' "no leadId" branch still looked up and mutated any
    existing lead by `visitorId` alone, with no token check, and handed
    the caller a fresh valid token for it. Fixed by treating "no leadId"
    as unconditionally "create new" — never a `visitorId`-based
    reattachment to an existing lead. See "Public funnel ownership" above
    and `src/lib/funnel-capability.ts`. Also hardened in Step 17:
    `FUNNEL_CAPABILITY_SECRET` now fails closed in production (no
    `AUTH_SECRET` fallback, enforced at both startup via
    `src/instrumentation.ts` and per-request), and tokens now expire
    (`LEAD_TOKEN_TTL_MS`, 4 hours) instead of being valid indefinitely.
11. ~~**Double-booking guard didn't actually work; no server-side
    duration/slot validation.**~~ **Fixed 2026-08-21 (Step 15), with one
    honestly-documented residual gap.** See the Scheduling architecture
    section above. The same-slot race is provably atomic (partial unique
    DB index, now verified against PostgreSQL). The daily-capacity and
    reschedule races are also closed and verified against PostgreSQL 17.11 by
    simultaneous real-route requests plus persisted-row assertions. Bounded
    `P2034` retries rerun the complete serializable transaction. See Scheduling
    architecture and `docs/POSTGRESQL.md`.
12. **Funnel capability tokens are stored in `localStorage`, not an
    `httpOnly` cookie** (confirmed, Step 17 — see "Public funnel
    ownership" above for the full analysis). This does not meaningfully
    weaken the token against an *active* same-origin XSS attacker (who
    can issue authenticated requests directly, without needing to read
    the token), but it does mean a token that leaks some other way is
    exfiltratable and reusable outside the page/session that received it,
    until it expires (bounded now by the Step 17 TTL fix, previously
    unbounded). Recommended fix: move to an `httpOnly`, `Secure`,
    `SameSite=Lax` cookie with CSRF-aware design — deliberately not
    implemented in Step 17 to avoid redesigning the funnel's
    request/response contract in the same change as the IDOR/
    continuation/concurrency/duration fixes.
13. ~~**Business-hours/slot generation and dashboard reporting used
    server-local time.**~~ **Fixed (Step 20).** Operational boundaries,
    capacity grouping, and display now use validated `Company.timezone`
    through `src/lib/timezone.ts`; DST behavior is explicit and tested.
    Overnight hours remain unsupported and fail closed. See
    `docs/TIMEZONE.md`.
14. ~~**No rate limiting on public endpoints.**~~ **Implemented Step 18;
    distributed backend completed Step 23** with centralized per-action
    policies, privacy-hashed identifiers, explicit trusted-proxy handling,
    429/Retry-After, and atomic shared Redis counters. Backend outages fail
    closed with 503. See `docs/ENDPOINT_SECURITY.md`.
15. ~~**Seed script had a hardcoded production-capable default owner
    password.**~~ **Fixed (Step 21).** Deterministic owner credentials remain
    available only for development/test. Production seeding requires explicit
    validated credentials, rejects the development identity and weak/default
    passwords, never prints plaintext, and leaves an existing user's password
    hash unchanged. See `docs/PRODUCTION_SETUP.md`.

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
