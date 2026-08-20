# Architecture

Status: **Finalized for v1 build.** Changes to any decision below must be made
here first, with rationale, before code changes that contradict it.

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

## Multi-tenancy

Single company is deployed for v1, but every tenant-owned table carries a
`companyId` from day one and all queries are scoped by it. No cross-tenant
sharing, no premature tenant-admin UI, no billing/plan system — just a data
model that will not need a breaking migration to onboard a second company.

## Data model (high level)

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

## Qualification, scoring, and scheduling as pure logic

Lead scoring, MQL/SQL classification, service-area validation, and
appointment-availability/double-booking logic are implemented as pure,
independently testable functions operating on plain data — not buried in UI
components or route handlers — so they can be unit tested directly and
reused between the public funnel, the CRM, and the dashboard.

## Compliance boundaries

- No functionality advises or facilitates violating an existing provider's
  contract.
- No outbound communication bypasses consent/opt-out, do-not-call, TCPA, or
  CAN-SPAM requirements; consent and opt-out state are first-class fields.
- No fabricated analytics, reviews, customers, appointments, revenue, or
  third-party integrations. Metrics reflect real stored data or explicitly
  show as unavailable.
