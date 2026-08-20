# Goal Audit — Full Repository vs. Master /goal

Date: 2026-08-20. Performed against `main` (single commit `30529b7 Initial
project setup`, plus uncommitted `TASKS.md`/`docs/ARCHITECTURE.md` edits and
new `docs/DATA_MODEL.md`/`docs/EVENTS.md`/`docs/STATES.md` from the prior
review — see **Git status** below).

## Method — what was actually run, not just read

Every status below is backed by either (a) reading the real code and schema,
cross-checked line-by-line against claims in `TASKS.md`, or (b) executing
the project's real verification commands, fresh, right before writing this
document:

| Command | Result |
|---|---|
| `npm run test` (Vitest) | **51/51 tests passed** |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` (ESLint) | **0 errors/warnings** |
| `npm run build` (`next build`) | **Succeeded** — all 19 routes compiled (2 static, 17 dynamic) |
| `npx playwright test` (`e2e/full-funnel.spec.ts`) | **1/1 passed**, live, against the real dev server and real SQLite dev database — drove the entire required journey: landing page w/ UTM params → qualification funnel → contact capture → SQL classification → availability → booking → a second concurrent lead correctly blocked with `409` (double-booking prevention) → owner login → dashboard shows the real booking and cost metric → CRM pipeline shows the lead → mark inspection completed → mark customer won with contract value → dashboard reflects won count + revenue → marketing spend entry → cost-per-booked-inspection becomes a real computed number |

This means the core homeowner journey is not merely "code that looks
right" — it was exercised end-to-end, live, moments before this document
was written, and passed.

## Git status

Only one commit exists (`30529b7`). The documentation work from the prior
review (`docs/ARCHITECTURE.md` edits, new `docs/DATA_MODEL.md`,
`docs/EVENTS.md`, `docs/STATES.md`, and the `TASKS.md` milestone
reorganization) is **uncommitted** in the working tree. No application code
has been modified by any review to date.

---

## Audit tables

Status vocabulary: **COMPLETE AND WORKING** · **IMPLEMENTED BUT NEEDS
VERIFICATION** · **PARTIALLY IMPLEMENTED** · **MOCKED/DEMO ONLY** · **NOT
IMPLEMENTED** · **BLOCKED BY EXTERNAL CREDENTIALS OR SERVICES**

### Customer acquisition

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Landing page | COMPLETE AND WORKING | `src/app/page.tsx`; e2e visits `/` with UTM params and proceeds | none | — | — |
| Mobile responsiveness | PARTIALLY IMPLEMENTED | Tailwind responsive classes throughout (`sm:` breakpoints in `page.tsx`, dashboard pages) | Never checked against a real device/viewport, only "conceptually" per prior TASKS.md note | P2 | Manual pass at 375px width min |
| SEO technical structure | NOT IMPLEMENTED | `src/app/layout.tsx` has only `title`/`description` | No structured data (JSON-LD LocalBusiness), no `sitemap.xml`, no `robots.txt` (`public/` has only default Next.js SVGs) | P2 | Add `app/sitemap.ts`, `app/robots.ts`, JSON-LD on landing page |
| CTA flow | COMPLETE AND WORKING | Single CTA `Get My Free Inspection` → `/inspection`, verified in e2e | none for the flow itself | — | — |
| Source tracking | COMPLETE AND WORKING | `src/lib/attribution.ts`, persisted on `Lead` first-touch, verified in e2e (`utm_source=google` flows through to `lead.source`) | — | — | — |
| UTM capture | COMPLETE AND WORKING | `parseAttribution()` reads all 5 UTM params + click IDs | — | — | — |
| `cta_clicked` event | NOT IMPLEMENTED | grep of `track(` calls confirms only `visit`/`assessment_start` fire | No CTA-level analytics | P2 | Add `track("cta_clicked")` on the landing CTA |

### Qualification

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Progressive questionnaire | COMPLETE AND WORKING | `src/lib/qualification.ts` + `src/app/inspection/page.tsx`; e2e walks all 6 questions | — | — | — |
| Conditional branching | COMPLETE AND WORKING | `switchReason.showIf` only asked when `hasExistingProvider === true` | — | — | — |
| Pest questions | COMPLETE AND WORKING | `pestType`, `pestSeverity` questions | — | — | — |
| Property questions | COMPLETE AND WORKING | `zipCode`, `isHomeowner` | — | — | — |
| Service-area validation | COMPLETE AND WORKING | `isInServiceArea()`, verified in e2e (`73301` is seeded as in-area) | — | — | — |
| Existing-provider/switching path | COMPLETE AND WORKING | `hasExistingProvider` → `switchReason` with `SWITCHER_DISCLAIMER` (contract-non-interference compliance text) | — | — | — |
| Contact capture | COMPLETE AND WORKING | Contact form in `inspection/page.tsx`, verified in e2e | — | — | — |
| Lead creation | COMPLETE AND WORKING | `POST /api/leads` upsert, verified in e2e | — | — | — |
| `assessment_step_completed` event | NOT IMPLEMENTED | Only `assessment_start` fires; no per-question event | Per-step drop-off inside the funnel isn't measurable | P2 | Fire an event (or reuse `/api/leads` writes) per question answered |

### Lead scoring

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Configurable scoring | COMPLETE AND WORKING | `Company.scoringRules` JSON, `src/lib/scoring.ts`, 106-line test file passing | No admin UI to edit rules (DB/seed only) | P2 | Settings milestone |
| MQL classification | COMPLETE AND WORKING | `classifyLead()`, threshold `Company.mqlThreshold` | — | — | — |
| SQL classification | COMPLETE AND WORKING | Same function, `sqlThreshold`; verified in e2e (severe termites + ASAP → `sql`) | — | — | — |
| High-intent logic | COMPLETE AND WORKING | `DEFAULT_SCORING_RULES` weights severity/timeline/high-risk pest/switcher dissatisfaction | — | — | — |
| Score persistence | COMPLETE AND WORKING | `Lead.score`/`classification` columns | **No history** — score changes aren't audit-logged | P1 | Write score changes to `AuditLog` before scoring-rule tuning ships as a feature |

### Scheduling

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Availability | COMPLETE AND WORKING | `generateCandidateSlots`/`filterAvailableSlots`, `GET /api/availability`, verified in e2e | — | — | — |
| Business hours | COMPLETE AND WORKING | `Company.businessHours` JSON, `DEFAULT_BUSINESS_HOURS` seeded | — | — | — |
| Capacity | COMPLETE AND WORKING | `maxDailyInspections` enforced in `assertSlotBookable`/`filterAvailableSlots`, unit-tested | — | — | — |
| Double-booking protection | COMPLETE AND WORKING | App-level overlap check + DB `@@unique([inspectorId, scheduledStart])`; **verified live in this run** — second lead's booking attempt returned `409` | — | — | — |
| Booking | COMPLETE AND WORKING | `POST /api/appointments`, verified in e2e | — | — | — |
| Rescheduling | PARTIALLY IMPLEMENTED | `PATCH /api/appointments/[id]` `action: "reschedule"` updates time in place | `status: "rescheduled"` and `rescheduledFromId` are declared in the schema but **never actually set** by this action — see `docs/STATES.md` | P2 | Either drop the unused status/field or start using them |
| Cancellation | COMPLETE AND WORKING (fixed 2026-08-20) | Both the API route and the CRM page's `cancelAppointment` server action now call the shared `cancelAppointmentAndNotify()` (`src/lib/appointment-actions.ts`); behaviorally verified against the real dev DB (email send + lead-status reversion confirmed) and via the full test/lint/typecheck/build/e2e suite, all passing | Neither path writes an `AuditLog` row for cancellation (unlike reschedule) — a separate, still-open gap, not part of this fix | P1 (remaining audit-log gap only) | See "AuditLog coverage is inconsistent" row under Pipeline |
| No-show | COMPLETE AND WORKING | Both the API route and the CRM page set `status: "no_show"` consistently (neither logs to `AuditLog`, consistent behavior) | No-show has no distinct `FunnelEvent` | P2 | See Attribution/Analytics gap below |
| Completion | COMPLETE AND WORKING | Both code paths set `status: "completed"`, advance `Lead.status`, and write the `appointment_completed` `FunnelEvent` consistently; verified in e2e | — | — | — |
| Inspector assignment | PARTIALLY IMPLEMENTED | `Inspector` model + `Appointment.inspectorId` (nullable) exist; one default inspector seeded | No auto-assignment logic, no per-inspector availability (`AvailabilityRule`) — company-wide hours only | P2 | Build when a second inspector is added |

### CRM

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Lead list | COMPLETE AND WORKING | `/dashboard/leads`, verified in e2e | — | — | — |
| Lead profile | COMPLETE AND WORKING | `/dashboard/leads/[id]`, verified in e2e | — | — | — |
| Contact data | COMPLETE AND WORKING | Rendered on lead detail page | — | — | — |
| Property data | COMPLETE AND WORKING | ZIP shown; address lines captured on `Lead` but not currently rendered on the detail page | Minor — `addressLine1/2`/`city`/`state` are stored but not displayed | P2 | Add to lead-detail UI |
| Qualification answers | COMPLETE AND WORKING | Rendered from `Lead.qualificationAnswers` JSON | — | — | — |
| Lead score | COMPLETE AND WORKING | Score + classification shown | — | — | — |
| Source/campaign | COMPLETE AND WORKING | `lead.source` shown; `medium`/`campaign`/`content`/`term` stored but not rendered | Minor — only `source` is surfaced in the UI today | P2 | Show full attribution block |
| Appointment details | COMPLETE AND WORKING | Appointments listed with actions | — | — | — |
| Notes | COMPLETE AND WORKING | `LeadNote` create/list, verified in code | — | — | — |
| Activity timeline | COMPLETE AND WORKING | `FunnelEvent`s rendered chronologically | Missing reschedule/cancel/no-show events (see Pipeline) means the timeline has visible gaps for those moments | P1 | See Pipeline gap |

### Pipeline

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Lead stages | COMPLETE AND WORKING | `LEAD_STATUSES` in `src/lib/pipeline.ts`, matches required funnel | — | — | — |
| Valid state transitions | PARTIALLY IMPLEMENTED | Forward-ratcheted auto-transitions work correctly (verified in e2e); manual override via CRM `<select>` accepts **any → any** with no validity check (`docs/STATES.md`) | No guard against invalid manual transitions (e.g. `customer_won` → `new`) | P1 | Decide if this is intentional; if not, add a transition-validity check to `PATCH /api/leads/[id]` and the page action |
| Pipeline UI | COMPLETE AND WORKING | `/dashboard/leads` kanban-style board, verified in e2e | — | — | — |
| Customer won/lost | COMPLETE AND WORKING | Outcome + contract value, verified live in this run | — | — | — |
| `AuditLog` coverage | PARTIALLY IMPLEMENTED | Written for Lead status changes and appointment reschedule | Not written for appointment cancel/no-show/complete, or lead-score changes | P1 | Extend audit coverage before this becomes a compliance/ops question |
| `inspection_rescheduled`/`cancelled`/`no_show` funnel events | NOT IMPLEMENTED | grep of `FUNNEL_EVENT_TYPES` and all `prisma.funnelEvent.create` call sites confirms none exist | These three real-world moments are invisible to the append-only funnel log (though `Appointment.status` itself is correct) | P1 | Add `FunnelEvent` writes to the three corresponding action handlers |

### Calendar

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Daily view | COMPLETE AND WORKING | `/dashboard/calendar?view=day` | — | — | — |
| Weekly view | COMPLETE AND WORKING | default view, verified in code | — | — | — |
| Monthly view | COMPLETE AND WORKING | `?view=month` | — | — | — |
| Appointment management | PARTIALLY IMPLEMENTED | Calendar entries link to the lead detail page where cancel/no-show/complete live | No inline reschedule/cancel directly from the calendar view itself | P2 | Optional UX improvement, not a functional gap |

### Owner dashboard

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Today's inspections | COMPLETE AND WORKING | "Booked today" stat, verified live in this run | — | — | — |
| Weekly inspections | COMPLETE AND WORKING | "Booked this week" stat | — | — | — |
| New leads | COMPLETE AND WORKING | "New leads" stat | — | — | — |
| Qualified leads / MQL / SQL | COMPLETE AND WORKING | Separate MQL/SQL stat cards | — | — | — |
| Completed inspections | COMPLETE AND WORKING | "Completed" stat, verified live | — | — | — |
| Customers won/lost | COMPLETE AND WORKING | Verified live in this run | — | — | — |
| Conversion rates | COMPLETE AND WORKING | Show rate, close rate, funnel drop-off table, all null-safe | — | — | — |
| Cost metrics | COMPLETE AND WORKING | Verified live: cost-per-booked-inspection became a real `$` figure once spend was entered | — | — | — |
| Source/campaign breakdown UI | NOT IMPLEMENTED | `GET /api/analytics/funnel` already computes `sourceBreakdown`; no dashboard page renders it | Data exists, no UI consumes it | P2 | Add a dashboard section for it |
| Mobile-responsive | PARTIALLY IMPLEMENTED | Responsive grid classes present, not device-verified | See Customer Acquisition | P2 | — |

### Attribution

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Source/Medium/Campaign/Content/Term/Landing page | COMPLETE AND WORKING (first-touch) | All columns on `Lead` and `FunnelEvent`, verified live | — | — | — |
| First-touch attribution | COMPLETE AND WORKING | Set once on lead creation, never overwritten, verified live (`utm_source=google` persisted through the whole run) | — | — | — |
| Lead attribution persistence | COMPLETE AND WORKING | Same as above | — | — | — |
| Per-event (multi-touch) attribution | PARTIALLY IMPLEMENTED | `FunnelEvent` has the columns, but only `visit`/`assessment_start` resolve them fresh — the rest copy the lead's first touch or carry none (`docs/EVENTS.md`) | True multi-touch/last-touch analysis isn't derivable from current data | P2 | Pass current-visit attribution through every server-side event-creation call site |

### Analytics

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Page views (`visit`) | COMPLETE AND WORKING | Fires on landing page load | Fires only on `/`, not app-wide | P2 | Acceptable for a single-funnel product |
| Funnel starts (`assessment_start`) | COMPLETE AND WORKING | Fires on `/inspection` load | — | — | — |
| Contact capture event | COMPLETE AND WORKING | `contact_captured`, verified in code path | — | — | — |
| Lead creation event | COMPLETE AND WORKING | `lead_created` | — | — | — |
| MQL/SQL events | COMPLETE AND WORKING | `mql`/`sql`, verified live (SQL event fired for the e2e lead) | — | — | — |
| Scheduler view event | COMPLETE AND WORKING | `scheduler_viewed` on `GET /api/availability` | — | — | — |
| Inspection booking event | COMPLETE AND WORKING | `appointment_booked`, verified live | — | — | — |
| Inspection completion event | COMPLETE AND WORKING | `appointment_completed`, verified live | — | — | — |
| Customer won/lost events | COMPLETE AND WORKING | Verified live | — | — | — |
| Funnel drop-off analytics | COMPLETE AND WORKING | `computeStageConversionRates`, rendered on dashboard, null-safe when no data | — | — | — |
| Conversion calculations | COMPLETE AND WORKING | Same as above | — | — | — |

### Economics

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Marketing spend entry | COMPLETE AND WORKING | `/dashboard/marketing`, verified live (entry added, appeared in list) | Page's server action duplicates the validated `/api/marketing-spend` route's logic rather than calling it (no `amountCents` int coercion double-check, though both paths compute the same way) | P2 | Consolidate into one code path |
| Cost per lead | COMPLETE AND WORKING | `computeCostMetrics`, verified live (real `$` after spend entered) | — | — | — |
| Cost per MQL | COMPLETE AND WORKING | Same function | — | — | — |
| Cost per SQL | COMPLETE AND WORKING | Same function | — | — | — |
| Cost per booked inspection | COMPLETE AND WORKING | North-star metric, verified live becoming a real number | — | — | — |
| Cost per completed inspection | COMPLETE AND WORKING | Same function | — | — | — |
| Customer acquisition cost | COMPLETE AND WORKING | `computeCac`, null until spend + a won customer exist | — | — | — |
| Revenue/contract value | COMPLETE AND WORKING | `Lead.contractValueCents`, verified live ("Revenue attributed" showed `$` after Mark Won) | Single value per lead, no multi-invoice ledger | P2 | Only if recurring revenue is needed later |
| ROI/ROAS | COMPLETE AND WORKING | `computeReturnOnSpend`, null until both revenue and spend exist | — | — | — |

### Communications

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Confirmation architecture | COMPLETE AND WORKING (dev provider) | `sendIfConsented` on booking, verified in code | — | — | — |
| Reminder architecture | PARTIALLY IMPLEMENTED | `MESSAGE_TEMPLATES.appointmentReminder` template exists; nothing triggers it — no scheduled job | Reminders don't actually fire without a timer | P1 | Needs a cron/scheduled-task mechanism (external or platform-provided) |
| Rescheduling messages | COMPLETE AND WORKING | Sent from the API route's reschedule action | — | — | — |
| Cancellation messages | COMPLETE AND WORKING (fixed 2026-08-20) | Both the API route and the CRM page now send via the shared `cancelAppointmentAndNotify()` (see Scheduling) | — | — | — |
| Email abstraction | COMPLETE AND WORKING | `CommunicationProvider` interface, swappable | — | — | — |
| SMS abstraction | COMPLETE AND WORKING | Same interface, `channel: "sms"` | — | — | — |
| Consent handling | COMPLETE AND WORKING | `canSend()` gates every send on `emailConsent`/`smsConsent`/`optedOutAt`, unit-tested | — | — | — |
| Suppression/opt-out handling | COMPLETE AND WORKING (fixed 2026-08-20 — Step 9) | Durable, company-scoped `SuppressionEntry` table keyed by normalized email/phone (`src/lib/suppression.ts`), checked by the shared send gate (`sendIfAllowed`, used by every send call site) *before* per-lead consent, and by lead creation/contact capture (`POST /api/leads`) so a suppressed contact can't reactivate `smsConsent`/`emailConsent` under a new `Lead`/`visitorId`. CRM opt-out (`PATCH /api/leads/[id]` `{ optedOut: true }`) now persists into `SuppressionEntry`. Verified live: `e2e/suppression.spec.ts` — opt-out persists, a brand-new Lead with the same email/phone stays suppressed even while re-requesting consent, an unrelated contact is unaffected. Unit-tested: normalization, tenant-scoping, the shared-gate rejection path (`src/lib/suppression.test.ts`, 15 tests). | No suppression-management UI (opt-out is still only reachable via direct API call — there was no UI for it before this change either, so this is not a regression) and no un-suppress/re-consent flow. No distinction between marketing and transactional sends — the current system has none (every send, including booking confirmations, is gated identically), so suppression blocks all of them uniformly; this matches pre-existing `canSend` behavior and was deliberately not changed as part of this fix — see "Known gaps" below. | — | Add a suppression-management UI and a deliberate un-suppress flow when the CRM needs one; revisit the marketing/transactional distinction only if the business asks for transactional sends to bypass suppression |
| Live email/SMS provider | BLOCKED BY EXTERNAL CREDENTIALS OR SERVICES | `src/lib/communications.ts` only has a console-logging dev provider | No vendor chosen/contracted (deliberately, per `docs/ARCHITECTURE.md`) | P0 before real leads are contacted | Choose a vendor (e.g. an ESP + Twilio-compatible SMS API), obtain credentials, implement `CommunicationProvider` |
| Communication delivery log | COMPLETE AND WORKING (fixed 2026-08-20 — Step 11) | `Communication` table, written exclusively from the shared send gate (`sendIfAllowed()` in `src/lib/suppression.ts` → `src/lib/communication-log.ts`), covering booking confirmation, reschedule, and cancellation sends. Records company/lead/appointment, channel, message type, attempted-at, and a precise status (`blocked`/`sent`/`failed`, with `blockedReason`/`failureReason`/`providerMessageId` as applicable) — `sent` means the provider accepted the message, never that it was delivered. Verified live: `e2e/communication-log.spec.ts` — booking/reschedule/cancel each persist a `sent` record tied to the right lead/appointment, and a suppressed contact's confirmation persists as `blocked`. Unit-tested: all three blocked/sent/failed paths and correct company/lead scoping (`src/lib/suppression.test.ts`). Queryable via `GET /api/leads/[id]` (`lead.communications`). | No CRM UI renders the log yet (out of scope for this fix — the requirement was persistence and shared-gate enforcement, not a UI). `queued`/`delivered`/`bounced`/`undeliverable` statuses are declared for a future async/webhook-driven provider but nothing writes them yet — correct, since no such provider exists. | — | Render `lead.communications` on the CRM lead-detail page once there's an owner-facing need for it; wire `delivered`/`bounced`/`undeliverable` when a live provider with delivery webhooks is chosen |

### Authentication / security

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Authentication | COMPLETE AND WORKING | Auth.js v5 credentials + bcrypt + JWT, verified live (owner login succeeded) | — | — | — |
| Authorization | PARTIALLY IMPLEMENTED | Every protected route/page requires a session (`requireSession()`) | No route/UI behaves differently for `owner` vs `staff` — `role` is carried but unused | P1 | Decide required staff/owner distinction, then gate |
| Role separation | NOT IMPLEMENTED | `User.role` is a free string, checked nowhere | Same as above | P1 | Same as above |
| Tenant/company isolation | IMPLEMENTED BUT NEEDS VERIFICATION | Every Prisma query in every route/page is scoped by `session.companyId`, consistently, by code inspection | Only one `Company` exists — never exercised by a test with two tenants proving cross-tenant queries actually return nothing | P1 | Add a second seeded company + a cross-tenant isolation test |
| Input validation | COMPLETE AND WORKING | Zod schemas on every mutating API route (`/api/leads`, `/api/appointments`, `/api/track`, `/api/marketing-spend`, notes) | — | — | — |
| Secrets | COMPLETE AND WORKING | `.env` gitignored (`.gitignore` confirmed: `.env`, `.env.*`, `!.env.example`), `.env.example` has placeholders only, `.env` itself has real local values not committed | — | — | — |
| Rate limiting | NOT IMPLEMENTED | No `middleware.ts` exists in the repo; public unauthenticated endpoints (`/api/leads` POST, `/api/track`, `/api/appointments` POST) have no throttling | Public lead-capture/booking endpoints are spammable/abusable with no rate limit today | P1 before real public traffic | Add basic IP-based rate limiting (edge middleware or a provider-level WAF rule) before launch |
| Webhook validation | NOT APPLICABLE YET | No webhook-receiving endpoints exist in the codebase (no payment/SMS-provider webhooks) | N/A until a live provider with webhooks (e.g. delivery-status callbacks) is integrated | P2 | Add signature verification when that integration happens |
| Audit logging | PARTIALLY IMPLEMENTED | See Pipeline — real but inconsistent coverage | — | P1 | See Pipeline gap |

### Testing

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Unit tests | COMPLETE AND WORKING | **51/51 passing** as of the original audit; **70/70 passing** as of 2026-08-20 Step 11 (suppression + communication-log coverage added) | — | — | — |
| Integration tests | PARTIALLY IMPLEMENTED | The e2e suite is the closest thing to integration coverage (hits real API routes + real DB); no narrower API-route-level integration tests | — | P2 | Optional — e2e coverage is currently strong |
| End-to-end tests | COMPLETE AND WORKING | **1/1 passing** as of the original audit; **4/4 passing** as of 2026-08-20 Step 11 (`full-funnel.spec.ts`, `suppression.spec.ts`, `communication-log.spec.ts` × 2 scenarios), run live and re-run twice to confirm repeatability against the persistent dev DB | Only the happy path + one conflict check on the main journey — no no-show/lost-outcome/second-company scenarios yet. Also: Step 11 fixed a pre-existing repeatability bug in `suppression.spec.ts` (hardcoded, non-stamped phone numbers meant the durable suppression it wrote on the first run would fail the test on every subsequent run against the same dev DB — now stamped like the email already was) | P1 | Add scenarios for the gaps found above once they're fixed |
| Production build | COMPLETE AND WORKING | **`next build` succeeded**, run fresh for this audit, all 19 routes compiled | — | — | — |
| Type checking | COMPLETE AND WORKING | **`tsc --noEmit` — 0 errors**, run fresh for this audit | — | — | — |
| Linting | COMPLETE AND WORKING | **`eslint` — 0 errors/warnings**, run fresh for this audit | — | — | — |
| CI pipeline | NOT IMPLEMENTED | No `.github/workflows/` directory exists | These checks only run when a human/agent remembers to run them locally | P1 | Add a GitHub Actions workflow running lint/typecheck/test/build/e2e on push |

---

## Critical Path to Goal Completion

Ordered by what must happen first. Items 1–3 protect the real homeowner
journey and compliance posture that already works today; items 4+ build
toward a safe production launch.

1. ~~**Fix the CRM-vs-API cancellation inconsistency**~~ **DONE
   (2026-08-20).** Both paths now call one shared
   `cancelAppointmentAndNotify()` function
   (`src/lib/appointment-actions.ts`). Verified behaviorally against the
   real dev DB and via the full test/lint/typecheck/build/e2e suite.
2. **Close the funnel-event gaps for reschedule/cancel/no-show** (Pipeline/
   Analytics). These are real state changes already happening in the app
   that are invisible to the analytics the dashboard/CRM timeline is built
   to show. Cheap to fix, high value for trusting the funnel data.
3. ~~**Add `SuppressionEntry`**~~ **DONE (2026-08-20, Step 9).** Durable,
   company-scoped, normalized-email/phone suppression now exists and is
   enforced at the shared send gate and at lead creation. See the
   Communications table above and `TASKS.md` for full detail. Behaviorally
   verified against the real dev DB (`e2e/suppression.spec.ts`) and via the
   full test/lint/typecheck/build/e2e suite, all passing.
4. ~~**Add a `Communication` delivery log**~~ **DONE (2026-08-20, Step
   11).** Every send attempt through the shared gate (`sendIfAllowed()`)
   now persists a `Communication` row (blocked/sent/failed, with
   provider-acceptance vs. delivery kept precise — see the Communications
   table above and `TASKS.md` for full detail). Behaviorally verified
   against the real dev DB (`e2e/communication-log.spec.ts`) and via the
   full test/lint/typecheck/build/e2e suite, all passing.
5. **Add basic rate limiting to public endpoints** (`/api/leads`,
   `/api/track`, `/api/appointments` POST) before the site takes real
   public traffic.
6. **Decide and implement role enforcement** (`owner` vs `staff`) if any
   staff-facing action should actually be owner-only — currently a design
   decision left open, worth closing before a second staff account exists.
7. **Extend `AuditLog` coverage** to appointment cancel/no-show/complete
   and lead-score changes.
8. **Add a CI pipeline** (lint/typecheck/test/build/e2e on push) so the
   verification this audit just did manually happens automatically going
   forward.
9. **Add a cross-tenant isolation test** with a second seeded company,
   proving the `companyId` scoping that's already in every query actually
   holds under test.
10. **Choose and wire a live email/SMS provider** (blocked on an external
    vendor decision/credentials) — do this only after items 3–4 exist,
    since sends need somewhere to be suppressed and logged.
11. **PostgreSQL production cutover** (blocked on external hosting/DB
    provisioning) — re-run the full verification suite (unit + e2e)
    against Postgres before this is considered done.
12. **Deployment config** (Dockerfile or hosting-specific config, env var
    documentation) — blocked on choosing a host.
13. **SEO/AEO polish, CTA/step-level event instrumentation, dashboard
    source-breakdown UI, mobile device verification** — lower-priority
    polish items that don't block the core journey or compliance posture.
