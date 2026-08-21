# Funnel Event Taxonomy

`FunnelEvent` is the tenant-scoped conversion log. Canonical names are declared
in `src/lib/pipeline.ts`; `src/lib/analytics-events.ts` is the centralized,
idempotent writer. Events contain opaque visitor/lead/appointment identifiers,
attribution dimensions, a funnel step, and narrowly allow-listed metadata—not
homeowner names, email, phone, address, qualification answers, or secrets.

## Browser interaction events

`POST /api/track` accepts only these non-authoritative events:

- `landing_page_view`
- `inspection_cta_clicked`
- `funnel_started`
- `appointment_selected`

The route resolves attribution from the URL/referrer and prefixes browser keys
server-side so a client cannot reserve a server conversion idempotency key.
Lead association additionally requires the lead ownership capability; a bare
lead/visitor pair is not sufficient. The endpoint rejects attempts to submit
qualification, booking, outcome, or revenue events.

## Server-authoritative funnel events

| Event | Authoritative firing point |
|---|---|
| `qualification_question_answered` | validated answer persisted by `POST /api/leads` |
| `contact_information_submitted` | contact information first persists on a lead |
| `lead_created` | lead row creation |
| `lead_qualified` / `lead_disqualified` | complete server validation, service/pest/homeowner gates, and server scoring |
| `scheduling_viewed` | authorized availability response |
| `inspection_booked` | inside the serializable booking transaction |
| `inspection_rescheduled` | inside the serializable reschedule transaction |
| `inspection_cancelled` | inside cancellation state transaction |
| `inspection_completed` | inside completion state transaction |
| `customer_won` / `customer_lost` | authenticated, tenant-owned CRM outcome mutation |
| `revenue_recorded` | authenticated won outcome with actual contract value |

Outcome and revenue are current-state data: one outcome row and one
`revenue_recorded` row per lead are upserted. Changing a won lead to lost
replaces the outcome event and marks its revenue row `revenue_removed`, so
historical corrections cannot double-count customers or retain invalid revenue.
No spend, revenue, delivery, or conversion is inferred from an attempted action.

Communication lifecycle events remain described in `docs/COMMUNICATIONS.md`.
See `docs/ANALYTICS.md` for calculation and attribution semantics.
