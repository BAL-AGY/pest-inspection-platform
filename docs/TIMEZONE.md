# Company Timezone and DST Semantics

## Authoritative source

`Company.timezone` is the operational timezone. It must be a valid IANA zone
such as `America/Chicago` (or `UTC`), never an abbreviation such as `CST` or
`EST`. `parseCompanyTimeZone()` validates it before scheduling or reporting;
invalid configuration fails closed.

`src/lib/timezone.ts` centralizes conversion and calendar boundaries using
`@date-fns/tz`, the maintained timezone companion for the installed date-fns
v4 stack. No route contains handwritten timezone-offset or DST rules.

## Storage and transport

Appointment `scheduledStart` and `scheduledEnd` are absolute instants. Prisma
persists them as database timestamps and public APIs transport them as ISO 8601
UTC strings. An appointment has no independent timezone: its business meaning
comes from the owning Company's timezone.

Clients submit an ISO instant. The server converts that instant into the
company's local wall time and verifies it is the canonical instant on the
configured business-hours slot grid. The appointment end remains
server-derived as start plus `inspectionDurationMinutes`.

## Slot generation

Availability enumerates company-local calendar dates and weekdays, reads that
weekday's local `businessHours`, creates wall-clock starts at configured
duration increments, then converts each valid start to a UTC instant. Range
iteration uses calendar days rather than fixed 24-hour additions.

The homeowner scheduler and owner calendar display appointment times in the
company timezone, including a short timezone name. Browser/server local zones
do not alter operational times.

## DST policy

- **Spring forward:** a wall time that does not exist fails component
  round-trip validation and is not generated or accepted.
- **Fall back:** an ambiguous wall time has one canonical slot: the first
  occurrence selected by `@date-fns/tz`. The repeated second instant is
  rejected by booking validation. This prevents two capacity units with the
  same local label.
- Local day ranges use `[local midnight, next local midnight)`, so transition
  days correctly span 23 or 25 elapsed hours.

## Capacity and database queries

Daily capacity is grouped by the appointment start's company-local date.
Booking and rescheduling convert that date's local midnight and following
midnight to UTC and query active appointments within the half-open range. An
appointment shortly after UTC midnight therefore counts toward the previous
Chicago day when appropriate.

The existing transaction recheck and partial unique active-slot index remain
the concurrency controls; timezone conversion does not replace them.

## Dashboard, calendar, and reporting

Dashboard “today” and Sunday-based “this week” appointment counts use company
local boundaries. Calendar day/week/month query windows and daily grouping use
the same local date key. This step changes only inspection-related temporal
boundaries; all-time funnel and marketing economics calculations remain
otherwise unchanged.

## Current limitations

- Business-hours intervals are same-day only. Overnight intervals where close
  is at or before open are unsupported and fail closed.
- There are no per-inspector timezone or availability rules; the current model
  intentionally uses one company-wide operational calendar.
- PostgreSQL daily-capacity concurrency still requires verification against a
  real PostgreSQL deployment, independently of the now-correct day boundary.
