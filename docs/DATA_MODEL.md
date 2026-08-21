# Data Model

Status: describes the **actual, implemented** schema in `prisma/schema.prisma`
as of this review, plus the reasoning behind where it diverges from a
maximal entity list. This is a companion to `docs/ARCHITECTURE.md` — that
file owns the stack decision record; this file owns the entity/relationship
detail. See `docs/STATES.md` for how `Lead.status` and `Appointment.status`
actually transition, and `docs/EVENTS.md` for the `FunnelEvent` taxonomy.

## Design principle: consolidate until a real need forces a split

Every tenant-owned table carries `companyId` (see ARCHITECTURE.md
multi-tenancy note). Beyond that, the schema deliberately **merges several
conceptually-separate entities into `Lead`** (contact, property,
qualification answers, score, consent) rather than modeling each as its own
table. This is a considered simplification, not an oversight: v1 serves one
company, one contact per lead, one property per lead, and one
qualification pass per lead. Splitting those out now would add joins to
every hot path (funnel write, scoring, dashboard reads) for a flexibility
the product doesn't need yet. The entity-by-entity notes below say exactly
where that stops being true and a split becomes warranted.

## Entities (as implemented)

### Company
The tenant. Branding (`name`, `slug`, `timezone`), service-area/operations
config (`serviceZipCodes`, `supportedPests`, `businessHours`,
`inspectionDurationMinutes`, `maxDailyInspections`, `pestCategoryConfig`,
`serviceArrangements` — JSON-encoded where
structured), lead-scoring config (`scoringRules`, `mqlThreshold`,
`sqlThreshold`), and marketing-economics assumptions
(`averageContractValueCents`, `estimatedCommissionPercent`, both nullable
until entered). One row today; every other tenant-owned table FKs to it.

### User
Staff/owner login. `role` is a validated string (`"owner" | "staff"`), not
a `Role` table — see **Role**, below.

### Role — not a separate table
Modeled as `User.role: string`. Two fixed values, checked in application
code, not database-enforced. **Fine while roles are fixed and per-company
permissions aren't customizable.** Promote to a real `Role` (and
`Permission`) table only if/when a company needs to define custom roles or
multi-tenant admin needs to differ per company — don't build it in
advance of that requirement.

### Lead — the merged CRM/funnel record
The center of the schema. Carries, in one row:
- **Contact**: `firstName`, `lastName`, `email`, `phone`
- **Property**: `addressLine1/2`, `city`, `state`, `zipCode`, `isHomeowner`
- **Qualification**: `qualificationAnswers` (JSON `Record<questionId,
  answer>`), `pestConcern`, derived acquisition `pestCategory`,
  `hasExistingProvider`, `existingProviderName`,
  `switchReason`
- **Scoring/classification**: `score`, `classification`
  (`prospect|mql|sql`)
- **Pipeline**: `status` (see `docs/STATES.md`), `outcome`, `lostReason`,
  `contractValueCents`, staff-confirmed `actualPestCategory`, and
  `serviceArrangement`
- **Attribution** (first-touch, set once and never overwritten after):
  `source`, `medium`, `campaign`, `content`, `term`, `landingPage`,
  `clickId`, `visitorId`
- **Consent**: `smsConsent`/`smsConsentAt`, `emailConsent`/`emailConsentAt`,
  `optedOutAt`

Indexed on `(companyId, status)` (pipeline board queries) and `visitorId`
(anonymous-to-identified linking).

Potential value configuration never populates `contractValueCents` and never
produces a revenue event. It is internal acquisition context only. Actual
revenue remains a staff-entered won contract value after inspection. See
`docs/SERVICE_CATALOG.md`.

### Contact — merged into Lead
No separate table. **Split it out** when a lead can have more than one
contact (e.g., a spouse or property manager who also needs
confirmations/reminders) or when a contact needs to exist independent of
any single lead (repeat customer across multiple service requests).

### Property — merged into Lead
No separate table. **Split it out** when one property can be associated
with multiple leads over time (repeat/recurring customer, multiple pest
issues at different times) or a lead can cover multiple properties — right
now a second inspection request from the same address becomes a new,
unrelated `Lead` row with no link back to the prior one.

### QualificationSession — not a separate entity
There's no row that represents "a funnel run" distinct from the `Lead`
itself; qualification progress lives directly on `Lead.qualificationAnswers`
plus the `assessment_start` / `lead_created` `FunnelEvent`s. This means an
**abandoned** session (visitor answered 2 of 6 questions, never came back)
is only reconstructable by cross-referencing `FunnelEvent` rows for a
`visitorId`, not queryable directly as "sessions in progress." Acceptable
for v1's funnel-conversion analytics (`src/lib/analytics.ts` works off the
event log); would need a dedicated entity if per-step resumability across
devices/sessions becomes a product requirement.

### QualificationAnswer — stored as one JSON blob, not one row per answer
`Lead.qualificationAnswers` is `Record<questionId, answer>`, not a related
table. This keeps the questionnaire schema-flexible — `src/lib/
qualification.ts` can add/reorder/condition questions without a migration
— and keeps scoring (`src/lib/scoring.ts`) a pure function over a plain
object. Public writes do not make the blob schema-free: Step 19's central
validator stores only declared, correctly typed, progressively completed
question answers. Derived facts (`inServiceArea`, supported-pest status,
contact capture) are recomputed from current Company configuration and Lead
fields rather than trusted from or persisted in this JSON. Trade-off: you
cannot currently ask the database "how many leads
answered `pestType = termites`" without deserializing every row in
application code. Acceptable at current scale; would move to a normalized
`QualificationAnswer(leadId, questionId, value)` table if per-question SQL
aggregation across thousands of leads becomes necessary.

### LeadScore — current value only, no history
`Lead.score`/`Lead.classification` hold the *current* value, recomputed
fresh on every qualification-answer write (`classifyLead` in
`src/app/api/leads/route.ts` — note: **not ratcheted**, so classification
can move down if scoring inputs change, while `Lead.status`, the pipeline
stage, is ratcheted and only moves forward — see `docs/STATES.md`). There
is an additional authoritative prerequisite: an incomplete questionnaire is
always classified `prospect`, regardless of its partial score. Scheduling
independently re-derives completion and company eligibility rather than
trusting this denormalized classification alone. There
is no `LeadScore` history table, and score changes are **not** written to
`AuditLog` (only `status_change` and appointment `rescheduled` actions are
today). **Gap worth closing before scoring-rule tuning becomes a live
owner-facing feature**: without a history, you can't answer "why did this
lead's score change" after the fact.

### Campaign / TrafficSource — free-text strings, not entities
`source`, `medium`, `campaign` are plain strings on `Lead` and
`FunnelEvent`, parsed from UTM params (`src/lib/attribution.ts`).
`MarketingSpend.source`/`medium`/`campaign`/`content` are also free text, matched to
lead/event data by string equality when computing cost metrics. There is
no campaign-lifecycle entity (budget, flight dates, channel metadata).
**Fine while spend entry and attribution are manual/ad-hoc.** Promote to
real `Campaign`/`TrafficSource` tables, referenced by ID, when campaign
budgets/dates need to be managed as first-class objects rather than
matched by string.

### VisitorAttribution / AttributionTouch
`VisitorAttribution` is unique by company/visitor and preserves immutable
first-touch plus mutable last-campaign/referral touch fields and timestamps.
Both snapshots copy to `Lead`; conversion `FunnelEvent` rows retain the current
last-touch snapshot. Direct/internal navigation does not erase a campaign.
See `docs/ANALYTICS.md` for reporting-model semantics.

### Appointment
Inspection booking: `leadId`, `inspectorId` (nullable — no inspector
required at booking time), `scheduledStart/End`, `status`
(`docs/STATES.md`), `completedAt`, `cancelledAt`,
`rescheduledFromId` (declared, currently unused — no code path sets it).

**Double-booking guard, fixed 2026-08-21 (Step 15).** The DB-level guard
used to be `@@unique([inspectorId, scheduledStart])`, but it provided no
real protection: every booking has `inspectorId = null` (no per-inspector
calendars exist), and SQL unique indexes treat NULLs as distinct, so
multiple null-inspector rows at the same `scheduledStart` never actually
violated it — the double-booking prevention that existed before this fix
relied entirely on a non-atomic check-then-insert read in the route
handler. It is now a **partial unique index** on
`(companyId, scheduledStart)`, filtered to `status IN ('booked',
'rescheduled')`, added via raw SQL in the PostgreSQL baseline migration
(not expressible as a Prisma
`@@unique` — the schema DSL has no filtered-index construct; see the
`Appointment` model's comment in `prisma/schema.prisma`). Scoped by
`companyId` rather than `inspectorId` to match the app's actual
single-shared-calendar model (`src/lib/scheduling.ts`'s overlap check is
already company-wide, not per-inspector); filtered to active statuses so
a cancelled appointment doesn't permanently block re-booking that slot.
Verified against PostgreSQL 17.11 with simultaneous live-route requests:
one same-slot request succeeds, one returns 409, and exactly one active row
exists. Cancellation then permits an active replacement at the identical
instant while preserving the cancelled history row.

Daily capacity is not a row-level unique constraint. Booking and rescheduling
use PostgreSQL serializable transactions plus a bounded three-attempt `P2034`
retry that reruns the complete company-local-day capacity check. The real
PostgreSQL suite proves different-slot booking and reschedule races cannot
persist more than `maxDailyInspections`; a failed reschedule retains its
original instant. See `docs/POSTGRESQL.md`.

All `DateTime` fields are PostgreSQL `TIMESTAMPTZ(3)`. Appointments remain UTC
instants in storage/API traffic; `Company.timezone` determines operational
calendar bounds in application code.

### Inspector
Minimal: `name`, `email`, `phone`, `active`. No linkage to
`AvailabilityRule` (below) — availability is company-wide, not
per-inspector.

### AvailabilityRule — not a separate entity
Availability is computed from three scalar `Company` fields
(`businessHours` JSON, `inspectionDurationMinutes`, `maxDailyInspections`)
applied uniformly across the whole company, not per inspector
(`src/lib/scheduling.ts`). This is consistent with TASKS.md's open item
"multi-inspector load balancing / assignment rules — not yet built." A
real `AvailabilityRule` entity (per-inspector hours, capacity, days off)
is the natural next step when a second inspector is added.

### Communication — implemented 2026-08-20 (Step 11)
**Extended in Step 24.** `Communication` now carries direction, purpose,
provider/account, company-scoped dedupe key, inbound sender/body, and separate
attempted/accepted/delivered/failed/bounced/received/provider-status timestamps.
Outbound bodies are not persisted. PostgreSQL uniqueness prevents duplicate
automation sends and ambiguous provider-message correlation. Logging is now a
mandatory pre-send reservation: if it fails, the provider is not called.

`CommunicationProviderAccount` maps one external provider account/sender to one
Company without storing credentials. `CommunicationWebhookEvent` stores a
payload hash, normalized event/outcome, correlation, and processing timestamps;
`(provider, providerEventId)` is unique. `SuppressionEntry.scope` distinguishes
marketing-only from all-message suppression. The authoritative current model is
documented in `docs/COMMUNICATIONS.md`.

Queryable per-lead via `GET /api/leads/[id]` (`lead.communications`,
alongside the existing `appointments`/`funnelEvents`/`notes` includes) —
no dedicated UI was built for it (out of scope for this fix; the CRM
lead-detail page doesn't render it yet).

### Consent — fields on Lead, not a history table
`smsConsent`/`emailConsent`/`optedOutAt` hold *current* state only, no
history of when/how consent was granted or revoked more than once.
Sufficient for "can we message this lead right now" (the only question
`canSend()` needs to answer). Would need a real `Consent(leadId, channel,
granted, source, at)` table if consent needs to be audited over time
(granted → revoked → re-granted) rather than just checked in the present.

### SuppressionEntry — implemented 2026-08-20 (Step 9)
`SuppressionEntry(companyId, channel, identifierType, identifierValue,
reason, source, metadata?, createdAt)`, unique on `(companyId, channel,
identifierType, identifierValue)`. `identifierValue` is a normalized email
(trimmed/lowercased — deliberately not alias-folded, so `user+tag@` and
`u.ser@` stay distinct) or phone (digits-only, US/Canada country code
stripped) — see `src/lib/suppression.ts`. `channel` is `"email"`, `"sms"`,
or `"all"`; a blanket opt-out (the only kind the current system produces,
matching `canSend`'s undifferentiated `optedOutAt` semantics) writes
`channel: "all"` entries for every identifier the contact has.

Checked in two places:
- **Send time**: `sendIfAllowed()` (the new shared gate — every send call
  site uses this instead of calling `communications.sendIfConsented`
  directly) checks `SuppressionEntry` before falling through to the
  existing per-lead `canSend` consent check.
- **Lead-write time**: `POST /api/leads` checks suppression by the
  request's normalized email/phone and refuses to set
  `smsConsent`/`emailConsent` to `true` for a suppressed identifier, even
  if the request explicitly asked for consent — this is what actually
  closes the "re-enter the funnel under a new visitorId" gap this table
  was designed for, independent of the send-time check.

Written to on CRM opt-out (`PATCH /api/leads/[id]` `{ optedOut: true }`).
Tenant-scoped like every other table (`companyId` in every query).
Step 24 adds explicit `marketing` versus `all` suppression scope. SMS STOP
uses `all`; email unsubscribe defaults to marketing-only unless the verified
provider event explicitly reports a broader scope.

### PipelineEvent — covered by AuditLog + FunnelEvent, not a third table
Status transitions are audit-logged generically via `AuditLog`
(`action/entityType/entityId/metadata`), and stage-crossing moments
(`mql`, `sql`, `appointment_booked`, `appointment_completed`,
`customer_won/lost`) are captured as `FunnelEvent`s. Adding a third,
overlapping `PipelineEvent` table would duplicate both. **Current
coverage is inconsistent, though**: `AuditLog` is written for `Lead`
status changes and appointment reschedules, but *not* for appointment
cancel/no-show/complete, or for the manual-override path's outcome
changes beyond the status field itself. Worth tightening call-site
coverage rather than adding a new entity.

### CustomerOutcome — merged into Lead
`outcome`/`lostReason`/`contractValueCents` live on `Lead`, one outcome
per lead. Correct for the current "a lead becomes a customer once" model.
Split into a separate table only if a lost lead can be re-engaged and win
again later and both outcomes need to be preserved.

### MarketingSpend
Implemented as designed: `source`, `medium?`, `campaign?`, `content?`, `periodStart/End`,
`amountCents`, matched to events by the same attribution dimensions
equality when computing cost metrics (`src/lib/dashboard-metrics.ts`).

### Revenue — merged into Lead
`Lead.contractValueCents` is the only revenue figure captured, one value
per won lead, set manually via the CRM. No separate `Revenue`/invoice
ledger. Correct for "one contract value per customer"; would split out
for multi-invoice or recurring-revenue tracking.

### Note
`LeadNote`: `leadId`, `authorId?`, `body`, `createdAt`. Implemented as
designed.

### AuditLog
`companyId`, `userId?`, `action`, `entityType`, `entityId`, `metadata`
(JSON). Currently written for: `Lead` manual status changes (both the CRM
override route and page action) and `Appointment` reschedules. **Not**
written for: appointment cancel/no-show/complete, or lead-score changes
(see **LeadScore**, above). Indexed on `(companyId, entityType,
entityId)`.

### Event → FunnelEvent
The idempotent event log described in `docs/EVENTS.md`. `companyId`,
`leadId?`, `appointmentId?`, `visitorId`, `eventType`, unique tenant-scoped
`eventKey`, `funnelStep`, demo mode, attribution fields, allow-listed metadata,
and `createdAt`. Revenue is the one intentional current-state event per lead.

## Relationship summary

```
Company 1─* User
Company 1─* Inspector
Company 1─* Lead
Company 1─* FunnelEvent
Company 1─* Appointment
Company 1─* MarketingSpend
Company 1─* AuditLog
Company 1─* SuppressionEntry
Company 1─* Communication

Lead 1─* LeadNote
Lead 1─* Appointment
Lead 1─* FunnelEvent  (leadId nullable pre-identification)
Lead 1─* Communication

Appointment 1─* Communication  (appointmentId nullable — not every send is appointment-scoped)

Inspector 1─* Appointment  (inspectorId nullable — no inspector assigned yet)

User 1─* AuditLog  (userId nullable — system-driven changes)
```

## Summary: requested entity list → implementation

| Requested entity | Implementation |
|---|---|
| Company | `Company` |
| User | `User` |
| Role | `User.role` string, not a table |
| Lead | `Lead` |
| Contact | merged into `Lead` |
| Property | merged into `Lead` |
| QualificationSession | not modeled — reconstructed from `FunnelEvent` |
| QualificationAnswer | `Lead.qualificationAnswers` JSON blob |
| LeadScore | `Lead.score`/`classification`, no history |
| Campaign | free-text `campaign` string |
| TrafficSource | free-text `source`/`medium` strings |
| AttributionTouch | `VisitorAttribution` first/last touch plus `FunnelEvent` snapshots |
| Appointment | `Appointment` |
| Inspector | `Inspector` |
| AvailabilityRule | `Company` scalar fields, company-wide not per-inspector |
| Communication | `Communication` — implemented 2026-08-20, see above |
| Consent | `Lead` consent fields, current-state only |
| SuppressionEntry | `SuppressionEntry` — implemented 2026-08-20, see above |
| PipelineEvent | `AuditLog` + `FunnelEvent`, inconsistent coverage |
| CustomerOutcome | merged into `Lead` |
| MarketingSpend | `MarketingSpend` |
| Revenue | `Lead.contractValueCents` |
| Note | `LeadNote` |
| AuditLog | `AuditLog` |
| Event | `FunnelEvent` |
