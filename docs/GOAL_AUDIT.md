# Goal Audit — Full Repository vs. Master /goal

Date: 2026-08-20. Performed against `main` (single commit `30529b7 Initial
project setup`, plus uncommitted `TASKS.md`/`docs/ARCHITECTURE.md` edits and
new `docs/DATA_MODEL.md`/`docs/EVENTS.md`/`docs/STATES.md` from the prior
review — see **Git status** below).

**2026-08-21 addendum (Step 15).** An independent second audit (OpenAI
Codex, read-only) flagged 13 potential production blockers not fully
captured by this document as originally written. Each was independently
re-verified against the actual code (not accepted at face value) before
any fix — three confirmed-critical findings (public lead ownership/IDOR,
a double-booking guard that never actually worked, and unvalidated
appointment timing) were fixed together; the rest are now tracked inline
in the tables below and in the Critical Path, whether fixed, confirmed-
but-still-open, or found to be already-known/deliberate scope. See the
Authentication/security, Scheduling, and Testing tables, and Critical Path
items 5–10, for the specifics.

**2026-08-21 addendum (Step 17).** A second, adversarial review of the
uncommitted Step 15 implementation (same reviewer, OpenAI Codex) found
that its IDOR fix was incomplete: `POST /api/leads`' "no leadId supplied"
branch still looked up and mutated *any existing lead* by `visitorId`
alone, with no ownership token check, and handed the caller a fresh valid
token for that lead afterward. A caller who knew or supplied a victim's
`visitorId` — not just their `leadId` — could still fully hijack their
lead. Root cause, exact fix, and the regression test that proves it are
documented in `docs/ARCHITECTURE.md` "Public funnel ownership." The same
review also required production-secret fail-closed behavior (implemented:
`src/instrumentation.ts` + `src/lib/funnel-capability.ts`, no
`AUTH_SECRET` fallback in production) and evaluation of token replay/
lifetime (implemented: 4-hour TTL; localStorage/XSS transport limitation
explicitly documented, not silently accepted — see ARCHITECTURE.md Known
gaps item 12).

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
| Progressive questionnaire | COMPLETE AND WORKING, SERVER-ENFORCED (Step 19) | `validateQualificationSubmission()` permits only the current visible question while accepting unchanged cumulative prior answers; route tests reject skipped/favorable shortcuts | — | — | — |
| Conditional branching | COMPLETE AND WORKING, SERVER-ENFORCED (Step 19) | `switchReason.showIf` controls both UI display and server applicability/required progression; invalid and omitted switcher answers are route-tested | — | — | — |
| Pest questions | COMPLETE AND WORKING | `pestType`, `pestSeverity` questions | — | — | — |
| Property questions | COMPLETE AND WORKING | `zipCode`, `isHomeowner` | — | — | — |
| Service-area / supported-service validation | COMPLETE AND WORKING, SERVER-ENFORCED (Step 19) | `deriveQualificationState()` resolves ZIP and pest support from the active Company's configuration; availability and booking re-derive it from stored validated answers | — | — | — |
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
| Double-booking protection | COMPLETE AND WORKING (fixed 2026-08-21 — Step 15) | An independent audit (Codex) found, and direct code inspection confirmed, that the previous `@@unique([inspectorId, scheduledStart])` guard provided **no real protection** — every booking has `inspectorId = null`, and SQL unique indexes treat NULLs as distinct, so it never actually fired. Replaced with a partial unique index on `(companyId, scheduledStart)` filtered to active statuses (migration `20260820220719_atomic_booking_slot_guard`), plus an in-transaction re-check under `Serializable` isolation immediately before every write. **Verified**: a standalone script proved the exact SQLite behavior (concurrent active bookings at the same slot → one `P2002`; cancel-then-rebook succeeds; two cancelled rows coexist); `e2e/booking-security.spec.ts` fires two genuinely concurrent `POST /api/appointments` requests via `Promise.all` and asserts exactly one succeeds — this is a materially stronger proof than the prior *sequential* two-request test. | The same-slot race is provably atomic on both SQLite and the PostgreSQL target (unique-index enforcement, not isolation-level-dependent). The **daily-capacity race** (two concurrent bookings at *different* times pushing a day over `maxDailyInspections`) is mitigated by the in-transaction re-check but **not provably closed under genuinely concurrent PostgreSQL load** — this requires verification against real PostgreSQL before production launch (see `docs/ARCHITECTURE.md` Scheduling architecture for the exact test). | P0 residual item before production launch: verify the capacity race against real PostgreSQL | Run a concurrent-capacity-exhaustion test against a real PostgreSQL instance once one exists |
| Booking timing/duration validation | COMPLETE AND WORKING (fixed 2026-08-21 — Step 15) | Codex flagged, and code inspection confirmed, that appointment `start`/`end` were trusted directly from the client with no server-side duration or slot-grid check. The server now always derives the authoritative end as `start + company.inspectionDurationMinutes` (client `end` is accepted for compatibility but never read), and `assertSlotBookable` rejects any duration mismatch (zero/negative/shortened/lengthened) and any `start` not aligned to the real slot grid. Applies to both initial booking and reschedule. Verified in `src/lib/scheduling.test.ts` (6 new adversarial unit tests) and `e2e/booking-security.spec.ts` (route-level: malicious `end` values are ignored and the persisted duration always matches; off-grid/off-hours starts are rejected with 400). | — | — | — |
| Inspector validation | COMPLETE AND WORKING (fixed 2026-08-21 — Step 15) | Codex flagged that a client-supplied `inspectorId` was accepted as an opaque id with no check it belonged to the company or was active. `POST /api/appointments` now looks it up scoped by `companyId` and `active: true`; missing/inactive/cross-tenant ids are rejected with 400 `invalid_inspector`. Verified in `e2e/booking-security.spec.ts` against real inactive and cross-tenant fixture inspectors. | — | — | — |
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
| Public funnel ownership (IDOR) | COMPLETE AND WORKING (fixed 2026-08-21 — Step 15, continuation-bypass closed + secret/lifetime hardened Step 17) | An independent audit (Codex) found, and direct code inspection confirmed, that `POST /api/leads` continuation, `POST /api/appointments`, and `GET /api/availability` trusted a bare `leadId` with no check the caller was the visitor who created it. Fixed with `src/lib/funnel-capability.ts`: an HMAC-signed capability token, derived from the lead's real server-side `visitorId` and a server-only secret, required (body field or `X-Funnel-Token` header) on every subsequent request; verification uses `crypto.timingSafeEqual`. **Step 17**: a second, adversarial review of that fix found it was incomplete — `POST /api/leads`' "no leadId" branch still looked up and mutated *any existing lead* by `visitorId` alone (no token check), and handed back a fresh valid token for it, so a leaked/known `visitorId` alone still fully hijacked a lead. Fixed by treating "no leadId" as unconditionally "create a new lead," never a `visitorId`-based reattachment — continuing an existing lead always requires `leadId` + a valid token now, no other path. Also hardened: `FUNNEL_CAPABILITY_SECRET` fails closed in production (no `AUTH_SECRET` fallback, enforced at both startup via `src/instrumentation.ts` and per-request) and tokens now expire after 4 hours (`LEAD_TOKEN_TTL_MS`) instead of being valid indefinitely. Verified: `src/lib/funnel-capability.test.ts` (14 unit tests: ownership, production-secret enforcement, TTL/expiry, future-dated-token rejection), `src/instrumentation.test.ts` (4 tests), and `e2e/booking-security.spec.ts` (13 real-route adversarial tests, including the exact continuation-bypass exploit — sanity-checked twice: the leadId-only fix and the visitorId-continuation fix were each independently confirmed to make their respective test genuinely fail when reverted, then re-applied). A full re-audit of every route accepting `leadId`/`visitorId`/`companyId`/a funnel token found no further instance of this pattern. | `POST /api/track` still accepts an unverified `leadId` — deliberately out of scope (write-only, informational, no data disclosure/mutation). Capability tokens are stored in `localStorage`, not an `httpOnly` cookie — documented, not silently accepted, as a real but narrower-than-it-sounds limitation (doesn't weaken protection against an *active* same-origin XSS attacker, who doesn't need to read the token to abuse it; does mean a token leaked another way is reusable until it expires). Recommended future fix: `httpOnly`/`Secure`/`SameSite` cookie with CSRF-aware design — deliberately deferred to avoid redesigning the funnel's transport contract in the same change. | — | — |
| Authorization | PARTIALLY IMPLEMENTED | Every protected route/page requires a session (`requireSession()`) | No route/UI behaves differently for `owner` vs `staff` — `role` is carried but unused | P1 | Decide required staff/owner distinction, then gate |
| Role separation | NOT IMPLEMENTED | `User.role` is a free string, checked nowhere | Same as above | P1 | Same as above |
| Tenant/company isolation | IMPLEMENTED BUT NEEDS VERIFICATION | Every Prisma query in every route/page is scoped by `session.companyId`, consistently, by code inspection | Only one `Company` exists — never exercised by a test with two tenants proving cross-tenant queries actually return nothing. Additionally (confirmed by the independent Codex audit): public routes resolve tenant via `getActiveCompany()` with no request-derived tenant signal at all (no subdomain/host resolution) — a deliberate, documented single-tenant-for-v1 scope (`src/lib/company.ts`'s own comment), not a live vulnerability today, but a real gap the moment a second company is onboarded without adding real tenant resolution first. | P1 | Add a second seeded company + a cross-tenant isolation test; add real tenant resolution to public routes before a second company goes live |
| Input validation | COMPLETE AND WORKING (qualification hardened Step 19) | Zod schemas on every mutating route plus centralized qualification question/type/option/ZIP/conditional/order validation. `/api/leads` is strict at the top level, so client `score`, `classification`, and `status` fields are rejected. | — | — | — |
| Secrets | COMPLETE AND WORKING | `.env` gitignored (`.gitignore` confirmed: `.env`, `.env.*`, `!.env.example`), `.env.example` has placeholders only, `.env` itself has real local values not committed. New in Step 15: `FUNNEL_CAPABILITY_SECRET` (falls back to `AUTH_SECRET` if unset), documented in `.env.example`. | The independent Codex audit found `prisma/seed.ts` has a hardcoded default owner password (`"changeme123"`) with no `NODE_ENV`/production guard — running `npm run db:seed` against production without setting `SEED_OWNER_PASSWORD` creates/leaves a full-access owner account with a publicly known password. Confirmed by direct code inspection. Not fixed in this pass. | P1 before production seeding | Refuse to seed with the default password when `NODE_ENV === "production"` |
| Rate limiting | IMPLEMENTED, SINGLE-PROCESS BACKEND (2026-08-21 Step 18) | Central `src/lib/rate-limit.ts` policies protect lead creation/continuation, tracking, availability, booking, and Auth.js POST actions. Identifiers are HMAC-hashed, forwarding headers are ignored unless trusted proxy hops are explicitly configured, and limited requests return 429 + Retry-After before mutation. `e2e/rate-limit.spec.ts` exercises real routes and DB non-mutation; the existing security/full-funnel suite still passes. | Current `InMemoryRateLimitStore` resets on restart and is not shared across replicas/serverless invocations. `/api/track` lead association also remains unverified even though flooding is bounded. | P1 before multi-instance production | Implement `RateLimitStore` with Redis/managed atomic counters or add an equivalent trusted edge/WAF control; configure and verify the host proxy chain |
| Business-hours/timezone correctness | CONFIRMED GAP (found by the independent Codex audit, not fixed in this pass) | Direct code inspection confirmed `src/lib/scheduling.ts` and `src/lib/dashboard-metrics.ts` interpret business-hours boundaries and "today"/"this week" dashboard cutoffs using server-local time (`new Date().setHours(...)`), never `company.timezone` — that field is used only for *display* formatting. If the production host's timezone differs from a company's configured timezone (likely — the deployment target is a generic Node host, commonly UTC), slot availability and dashboard reporting windows will be wrong by the offset and shift across DST. | Same as evidence | P0 before non-UTC-server or multi-region production deployment | Use a timezone-aware library (`date-fns-tz`/`Temporal`) in both files to interpret boundaries in `company.timezone`, not server-local time |
| Webhook validation | NOT APPLICABLE YET | No webhook-receiving endpoints exist in the codebase (no payment/SMS-provider webhooks) | N/A until a live provider with webhooks (e.g. delivery-status callbacks) is integrated | P2 | Add signature verification when that integration happens |
| Audit logging | PARTIALLY IMPLEMENTED | See Pipeline — real but inconsistent coverage | — | P1 | See Pipeline gap |

### Testing

| Requirement | Status | Evidence | Gap | Priority | Recommended next action |
|---|---|---|---|---|---|
| Unit tests | COMPLETE AND WORKING | **101/101 passing** after Step 19, including centralized qualification value, progression, conditional-branch, and booking-prerequisite tests | — | — | — |
| Integration tests | PARTIALLY IMPLEMENTED | The e2e suite is the closest thing to integration coverage (hits real API routes + real DB); no narrower API-route-level integration tests | — | P2 | Optional — e2e coverage is currently strong |
| End-to-end tests | COMPLETE AND WORKING | **24/24 passing** after Step 19. Four qualification-security scenarios exercise real routes/DB alongside the existing rate-limit, ownership, concurrency, suppression, communication, and full-funnel coverage. | No no-show/lost-outcome/second-company scenarios yet. Token expiry remains unit-tested rather than clock-faked through live HTTP. | P1 | Add scenarios for the remaining functional gaps when implemented |
| Production build | COMPLETE AND WORKING | **`next build` succeeded**, run fresh for this audit, all 19 routes compiled | — | — | — |
| Type checking | COMPLETE AND WORKING | **`tsc --noEmit` — 0 errors**, run fresh for this audit | — | — | — |
| Linting | COMPLETE AND WORKING | **`eslint` — 0 errors/warnings**, run fresh for this audit | — | — | — |
| CI pipeline | NOT IMPLEMENTED | No `.github/workflows/` directory exists | These checks only run when a human/agent remembers to run them locally | P1 | Add a GitHub Actions workflow running lint/typecheck/test/build/e2e on push |

---

## Critical Path to Goal Completion

Ordered by what must happen first. Items 1–6 protect the real homeowner
journey, compliance posture, and public-endpoint security that already
work today; items 7+ build toward a safe production launch.

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
5. ~~**Fix public lead ownership / IDOR on `leadId`-scoped public
   routes**~~ **DONE (2026-08-21, Step 15), with a continuation-bypass gap
   found and closed the same day (Step 17).** Confirmed via an independent
   audit (Codex) and direct code inspection: any caller who obtained a
   `leadId` could rewrite that lead's contact/consent or book its slot,
   with no ownership check. Fixed with an HMAC-signed capability token
   (`src/lib/funnel-capability.ts`) required on every subsequent request.
   **A second, adversarial review of that same fix (Step 17) found it was
   incomplete**: `POST /api/leads`' "no leadId" branch still looked up and
   mutated any existing lead by `visitorId` alone with no token check, and
   handed back a fresh valid token for it — a leaked/known `visitorId`
   alone still fully hijacked a lead. Fixed by treating "no leadId" as
   unconditionally "create new," never a `visitorId`-based reattachment.
   Also hardened: `FUNNEL_CAPABILITY_SECRET` fails closed in production
   (no fallback, enforced at startup and per-request) and tokens now
   expire after 4 hours instead of indefinitely. Verified against the real
   dev DB (`e2e/booking-security.spec.ts`, grown from 11 to 13 scenarios)
   and via the full test/lint/typecheck/build/e2e suite, all passing; both
   the original and the continuation-bypass fixes were independently
   sanity-checked by temporarily reverting each and confirming its test
   genuinely fails. A full re-audit of every route accepting
   `leadId`/`visitorId`/`companyId`/a token found no further instance of
   this bypass pattern. **Still open, deliberately deferred**: capability
   tokens are stored in `localStorage`, not an `httpOnly` cookie — see
   `docs/ARCHITECTURE.md` Known gaps item 12 for the honest analysis of
   what that does and doesn't protect against, and the recommended future
   fix. This was inserted ahead of items 6+ below because it was a live
   authorization gap, not a completeness/polish item.
6. ~~**Fix the double-booking guard and add server-side booking
   duration/slot/inspector validation**~~ **DONE (2026-08-21, Step 15),
   with one honestly-documented residual gap.** The prior DB unique
   constraint never actually fired (see Scheduling table above); replaced
   with a partial unique index, verified atomic against this
   environment's SQLite and via a genuinely concurrent
   `Promise.all`-based e2e test. Duration/slot-grid/inspector validation
   added server-side (previously fully client-trusted). **Residual,
   explicitly unproven item**: the daily-capacity race under concurrent
   PostgreSQL load — see Scheduling architecture in
   `docs/ARCHITECTURE.md` for the exact verification still required
   before production launch.
7. ~~**Add basic rate limiting to public endpoints.**~~ **IMPLEMENTED
   (2026-08-21 Step 18)** for lead creation/continuation, tracking,
   availability, booking, and Auth.js POST actions. Before multi-instance
   production, replace the current in-memory provider through the existing
   `RateLimitStore` boundary or deploy an equivalent trusted edge/WAF
   control. See `docs/ENDPOINT_SECURITY.md`.
8. **Fix business-hours/timezone handling to use `company.timezone`, not
   server-local time** — confirmed by the independent Codex audit and
   direct code inspection of `src/lib/scheduling.ts` and
   `src/lib/dashboard-metrics.ts`. Wrong slot availability and dashboard
   reporting windows the moment the production host's timezone differs
   from a company's configured timezone (likely on a generic Node host).
   Not fixed in Step 15 (out of scope for its three named fixes).
9. **Guard `prisma/seed.ts`'s default owner password against production
   use** — confirmed by the independent Codex audit: no `NODE_ENV` check,
   `SEED_OWNER_PASSWORD` unset falls back to a publicly known password.
   Cheap fix, real consequence if missed.
10. ~~**Constrain `POST /api/leads` qualification answers and enforce
    progression.**~~ **DONE (Step 19).** Central question/type/option/
    conditional/order validation rejects arbitrary or skipped answers;
    scoring uses only sanitized and server-derived data; availability and
    booking independently require complete, in-area, supported-pest,
    homeowner, contact-captured, SQL state. See `docs/QUALIFICATION.md`.
11. **Decide and implement role enforcement** (`owner` vs `staff`) if any
    staff-facing action should actually be owner-only — currently a design
    decision left open, worth closing before a second staff account exists.
12. **Extend `AuditLog` coverage** to appointment cancel/no-show/complete
    and lead-score changes.
13. **Add a CI pipeline** (lint/typecheck/test/build/e2e on push) so the
    verification this audit just did manually happens automatically going
    forward.
14. **Add a cross-tenant isolation test** with a second seeded company,
    proving the `companyId` scoping that's already in every query actually
    holds under test — and, per the independent Codex audit, add real
    tenant resolution to the public routes (`getActiveCompany()`
    currently has no request-derived tenant signal at all) before that
    second company goes live.
15. **Choose and wire a live email/SMS provider** (blocked on an external
    vendor decision/credentials) — do this only after suppression/logging
    (already done, Steps 9/11) and rate limiting (item 7) exist.
16. **PostgreSQL production cutover** (blocked on external hosting/DB
    provisioning) — re-run the full verification suite (unit + e2e)
    against Postgres before this is considered done, and specifically
    exercise the daily-capacity concurrency test flagged in item 6.
17. **Deployment config** (Dockerfile or hosting-specific config, env var
    documentation) — blocked on choosing a host.
18. **SEO/AEO polish, CTA/step-level event instrumentation, dashboard
    source-breakdown UI, mobile device verification** — lower-priority
    polish items that don't block the core journey or compliance posture.
