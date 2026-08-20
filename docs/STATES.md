# State Machines

Status: documents the **actual** transition logic in code for `Lead.status`
and `Appointment.status` (`src/lib/pipeline.ts` declares the value sets;
the transition *rules* live inline in the API routes, not as a shared
state-machine module). Where the implementation doesn't enforce something
you'd expect a state machine to enforce, that's called out explicitly
rather than glossed over.

## Lead state machine

### States (`LEAD_STATUSES`, `src/lib/pipeline.ts`)

```
new → engaged → mql → sql → inspection_booked → inspection_completed → customer_won
                                                                       → customer_lost
```

This matches the requested design and is not changed.

### `status` vs `classification` — two related but distinct fields

`Lead.classification` (`prospect | mql | sql`) is a **pure function of
score**, recomputed fresh on every qualification write
(`classifyLead(score, mqlThreshold, sqlThreshold)`) — it is not ratcheted
and could in principle move down if inputs changed.

`Lead.status` (the pipeline stage above) **is ratcheted** — it only moves
forward, via a rank comparison (`STATUS_RANK` in `POST /api/leads`):

```ts
if (rank("engaged") > rank(nextStatus) && answers were submitted this call)
  nextStatus = "engaged"
if (classification !== "prospect" && rank(classification) > rank(nextStatus))
  nextStatus = classification
```

So in practice: `status` starts at `new`, moves to `engaged` the moment
any qualification answer is submitted, then jumps to `mql` or `sql` the
moment `classification` first reaches that tier — and never moves
backward through this path, even if `classification` later drops.

### Actual transitions, by trigger

| Transition | Trigger | Where |
|---|---|---|
| `new → engaged` | any qualification answer submitted | `POST /api/leads` |
| `engaged → mql` / `→ sql` | score crosses threshold | `POST /api/leads` |
| `mql → sql` | score crosses SQL threshold | `POST /api/leads` |
| `sql → inspection_booked` | booking succeeds (requires `classification === "sql"` and in service area — see below) | `POST /api/appointments` |
| `inspection_booked → sql` | the appointment just booked is cancelled and it was the lead's only active appointment, **and** the lead is still SQL-classified | `PATCH /api/appointments/[id]` (`action: "cancel"`) |
| `inspection_booked → inspection_completed` | appointment marked complete | `PATCH /api/appointments/[id]` (`action: "complete"`), also the dashboard lead page |
| `* → customer_won` | outcome set to won | `PATCH /api/leads/[id]` |
| `* → customer_lost` | outcome set to lost | `PATCH /api/leads/[id]` |
| **any → any** | manual staff override | `PATCH /api/leads/[id]` (`status` field) and the CRM lead-detail page's status `<select>`, which lists **all** `LEAD_STATUSES` with no restriction on which one can be picked from the current one |

### Booking eligibility gate (not a `status` check — a `classification` +
service-area check)

`POST /api/appointments` and `GET /api/availability` both gate on:

```ts
if (lead.classification !== "sql" || !inArea) → 403 not_eligible
```

Note this checks `classification`, not `status` — so a lead whose
`status` somehow isn't yet `sql` (e.g., after a manual override) but whose
`classification` is `sql` can still book. This is consistent with
`classification` being the "is this lead actually qualified right now"
signal and `status` being "where is this lead in the pipeline" — but it
means the two fields can disagree, and nothing currently reconciles them
when they do.

### Known gaps in the Lead state machine

- **No transition-validation guard.** Beyond the automatic
  forward-ratchet in `POST /api/leads` and the outcome-forces-terminal
  rule in `PATCH /api/leads/[id]`, nothing prevents a manual override from
  setting *any* status to *any* other status — including moving a
  `customer_won` lead back to `new`, or skipping straight from `new` to
  `customer_won`. The CRM UI's status dropdown offers every value with no
  filtering. If staff-facing status control needs to stay this open
  (plausible — real pipelines have edge cases), that's a legitimate
  choice; it should be a **documented** choice rather than an implicit
  gap, which is why it's called out here.
- **Cancellation reversion is conditional and easy to miss.** A cancelled
  appointment only reverts `Lead.status` to `sql` if the lead is *still*
  SQL-classified at cancel time; otherwise `status` stays
  `inspection_booked` with no active appointment — a lead can be "stuck"
  showing as booked with nothing on the calendar. Worth a look before the
  Pipeline milestone's automation work.

## Appointment state machine

### States (`APPOINTMENT_STATUSES`, `src/lib/pipeline.ts`)

```
booked → rescheduled → cancelled
       →            → no_show
       →            → completed
```

### Actual transitions, by trigger

| Transition | Trigger | Where |
|---|---|---|
| *(create)* `→ booked` | booking succeeds, inside a DB transaction with the Lead status update and `appointment_booked` event | `POST /api/appointments` |
| `booked → cancelled` | staff cancels | `PATCH /api/appointments/[id]` (`action: "cancel"`), dashboard lead page |
| `booked → no_show` | staff marks no-show | `PATCH /api/appointments/[id]` (`action: "no_show"`), dashboard lead page |
| `booked → completed` | staff marks complete | `PATCH /api/appointments/[id]` (`action: "complete"`), dashboard lead page |
| `booked → booked` *(reschedule)* | staff reschedules | `PATCH /api/appointments/[id]` (`action: "reschedule"`) |

### `rescheduled` is a declared status that is never actually set

`APPOINTMENT_STATUSES` includes `"rescheduled"`, and the unique-slot and
availability queries filter on `status: { in: ["booked", "rescheduled"] }`
as if some appointments could carry that value — but **no code path ever
writes `status: "rescheduled"`**. The `reschedule` action only updates
`scheduledStart`/`scheduledEnd` and leaves `status` as `"booked"`. The
`rescheduledFromId` field on `Appointment` (meant to point at the prior
appointment when a reschedule creates a new row) is similarly declared
but unused — the current implementation reschedules **in place** (same
row, new time), not by creating a new appointment linked to the old one.

This isn't necessarily wrong — in-place rescheduling is simpler and
avoids orphaning history — but it means:
- `"rescheduled"` as a distinct, queryable state doesn't exist in
  practice; a rescheduled appointment is indistinguishable from one that
  was always going to be at that time, other than the `AuditLog` row
  recorded for the reschedule action.
- The requested `inspection_rescheduled` event (`docs/EVENTS.md`) has
  nowhere natural to hang off a status *value* change, since there isn't
  one — it would need to fire directly from the reschedule action instead.

**Recommendation**: either (a) keep in-place rescheduling and drop the
unused `"rescheduled"` status value and `rescheduledFromId` field from the
model to match reality, or (b) if reschedule history needs to be
queryable as its own state, actually set `status: "rescheduled"` briefly
or link old→new rows via `rescheduledFromId` as originally intended. This
is a documentation/consistency fix, not urgent — flagging it here so the
next agent touching scheduling code doesn't assume `"rescheduled"` rows
exist.

### Terminal states

`cancelled`, `no_show`, and `completed` are all terminal in the current
implementation — no code path transitions an appointment back out of any
of them (e.g., un-cancelling, or moving a `no_show` to `completed` after
the fact). If staff need to correct a mis-marked no-show, today that
requires a new appointment, not a state transition on the existing one.
