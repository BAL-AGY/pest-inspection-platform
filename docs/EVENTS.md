# Event Taxonomy

Status: documents the **actual** `FunnelEvent` types implemented
(`src/lib/pipeline.ts` → `FUNNEL_EVENT_TYPES`), where each one fires in
code, and how it compares to the requested taxonomy. Every event is a row
in the `FunnelEvent` table (`docs/DATA_MODEL.md`) — there is no separate
client-analytics pipeline; this table is the single source of truth for
funnel/attribution analytics (`src/lib/analytics.ts`).

## Event envelope

Every `FunnelEvent` row carries:

| Field | Meaning |
|---|---|
| `companyId` | tenant |
| `leadId` | nullable — null for pre-identification visits |
| `visitorId` | anonymous id, set client-side in `localStorage` (`src/lib/visitor.ts`), links pre- and post-identification activity |
| `eventType` | one of `FUNNEL_EVENT_TYPES` |
| `source`/`medium`/`campaign`/`content`/`term`/`landingPage`/`clickId` | attribution at time of event — **see "Attribution completeness" below; not uniformly fresh** |
| `metadata` | JSON, event-specific, optional |
| `createdAt` | server timestamp |

## Two firing paths

1. **Client-fired, via `track()` → `POST /api/track`** (`src/lib/
   visitor.ts`): resolves attribution fresh from the current page URL +
   referrer (`src/lib/attribution.ts`) on every call. Only two call sites
   exist today: `track("visit")` in `src/app/page.tsx` and
   `track("assessment_start")` in `src/app/inspection/page.tsx`.
2. **Server-fired, inline in an API route**, as a side effect of a
   state change (lead upsert, booking, appointment completion, outcome
   set). These copy the **lead's stored first-touch attribution**
   (`lead.source`, etc.) rather than resolving anything fresh from the
   current request, and some omit attribution entirely.

## Event-by-event reference

| Event type | Fires when | Fired from | Attribution |
|---|---|---|---|
| `visit` | Landing page loads | `src/app/page.tsx` → `track()` | fresh (path 1) |
| `assessment_start` | Qualification funnel page loads | `src/app/inspection/page.tsx` → `track()` | fresh (path 1) |
| `contact_captured` | Lead upsert includes email or phone for the first time | `POST /api/leads` | lead's first-touch |
| `lead_created` | First `POST /api/leads` upsert for a visitor (row didn't exist) | `POST /api/leads` | lead's first-touch |
| `mql` | `classification` becomes `"mql"` (wasn't already mql/sql) | `POST /api/leads` | lead's first-touch |
| `sql` | `classification` becomes `"sql"` | `POST /api/leads` | lead's first-touch |
| `scheduler_viewed` | Availability slots fetched for an SQL lead in service area | `GET /api/availability` | lead's first-touch |
| `appointment_booked` | Booking succeeds | `POST /api/appointments` | lead's first-touch |
| `appointment_completed` | Appointment marked complete | `PATCH /api/appointments/[id]` (`action: "complete"`) and the dashboard lead-detail page action | **none** |
| `customer_won` | Lead outcome set to `"won"` | `PATCH /api/leads/[id]` | **none** |
| `customer_lost` | Lead outcome set to `"lost"` | `PATCH /api/leads/[id]` | **none** |
| `communication_attempted` | Durable outbound reservation succeeds | `sendIfAllowed()` | communication metadata only |
| `communication_accepted` | Provider accepts an outbound request | `sendIfAllowed()` | communication metadata only |
| `communication_delivered` | Authenticated provider webhook confirms delivery | communication webhook | communication metadata only |
| `communication_failed` / `communication_bounced` | Provider request/status fails | send gate or webhook | communication metadata only |
| `communication_inbound` | Authenticated inbound reply is associated to a lead | communication webhook | no message body |
| `communication_opted_out` | Authenticated inbound STOP/unsubscribe is processed | communication webhook | no message body |

## Requested taxonomy → implementation, with gaps

| Requested | Implemented as | Notes |
|---|---|---|
| `page_view` | `visit` | Only fires on the landing page (`/`), not on every route change — there is no app-wide page-view tracker. |
| `cta_clicked` | **not implemented** | No CTA-click instrumentation exists anywhere in the codebase. Gap. |
| `assessment_started` | `assessment_start` | naming only |
| `assessment_step_completed` | **not implemented** | Only the funnel's *start* is tracked; there is no per-question-answered event. Given the funnel is progressive/conditional (`src/lib/qualification.ts`), this is the clearest instrumentation gap — step-level drop-off inside the questionnaire cannot currently be measured, only start→contact-captured as one block. |
| `contact_captured` | `contact_captured` | matches |
| `lead_created` | `lead_created` | matches |
| `mql_created` | `mql` | naming only |
| `sql_created` | `sql` | naming only |
| `scheduler_viewed` | `scheduler_viewed` | matches |
| `inspection_booked` | `appointment_booked` | naming: the *event* says "appointment", the *Lead.status* value for the same moment is `inspection_booked` (see `docs/STATES.md`). Same real-world moment, two different string vocabularies depending on which table you're reading — worth knowing when writing analytics queries. |
| `inspection_rescheduled` | **not implemented** | `PATCH /api/appointments/[id]` (`action: "reschedule"`) updates `scheduledStart/End` and writes an `AuditLog` row, but creates **no `FunnelEvent`**. Reschedule activity is invisible to funnel/conversion analytics. |
| `inspection_cancelled` | **not implemented** | `action: "cancel"` sets `Appointment.status = "cancelled"` and sends a message, but creates **no `FunnelEvent`** and no `AuditLog` row either. |
| `inspection_no_show` | **not implemented** | `action: "no_show"` sets `Appointment.status = "no_show"`. No `FunnelEvent`, no `AuditLog`. |
| `inspection_completed` | `appointment_completed` | naming only, but see "Attribution completeness" — this event carries no attribution |
| `customer_won` | `customer_won` | matches, no attribution carried |
| `customer_lost` | `customer_lost` | matches, no attribution carried |

**Why the three missing appointment-lifecycle events matter**: the
dashboard's show-rate and close-rate metrics (`computeShowRate`,
`computeCloseRate` in `src/lib/analytics.ts`) read `Appointment.status`
counts directly via Prisma, so those specific numbers are still correct
today. What's missing is the ability to see reschedule/cancel/no-show as
points in the **funnel event timeline** (e.g., on a lead's activity feed,
or in future cohort/attribution analysis broken down by outcome). Since
the north-star metric is *booked, kept* inspections, cancellation and
no-show visibility in the event log — not just the current-state
`Appointment.status` — is worth closing before the Communications
milestone (automated reminders) is built, since reminder logic will likely
need to react to these transitions.

## Attribution completeness

The landing CTA preserves its incoming query string when navigating to the
inspection funnel, so UTM/click parameters captured on the landing visit are
also present when the Lead is created. The full browser journey asserts that
the resulting source and campaign appear on the exact owner-facing lead.

Only `visit` and `assessment_start` carry attribution resolved fresh at
the moment of the event. Every other event either copies the lead's
first-touch attribution (`contact_captured`, `lead_created`, `mql`, `sql`,
`scheduler_viewed`, `appointment_booked`) or carries none at all
(`appointment_completed`, `customer_won`, `customer_lost`). This means:
first-touch source/medium/campaign reporting is reliable (it's what
`Lead.source` etc. already store); **true multi-touch or last-touch
attribution is not currently derivable from the event log**, despite the
schema comment describing `FunnelEvent` as keeping "its own [attribution]
for full-path analysis later." See `docs/DATA_MODEL.md` →
**AttributionTouch** for the corresponding data-model note.

## Metadata conventions

`metadata` is a free-form JSON string, used today only by `POST
/api/track` callers that pass an explicit `metadata` object (neither of
the two current client call sites do). No event type has a required
metadata shape yet. If/when `cta_clicked` or `assessment_step_completed`
are added, the natural metadata would be `{ ctaId, location }` and
`{ questionId, answer }` respectively — kept out of the event's own typed
columns because they're event-type-specific, matching the same
schema-flexibility rationale as `Lead.qualificationAnswers`.
