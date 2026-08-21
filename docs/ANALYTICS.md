# Analytics and Attribution

## Architecture

The application owns its analytics data; it does not send data to a third-party
analytics service. `FunnelEvent` is a PostgreSQL event log written through
`src/lib/analytics-events.ts`. A company/event-key unique constraint makes
retries and refreshes idempotent. Booking, rescheduling, cancellation, and
completion events are committed in the same database transaction as their
authoritative state change.

Browser tracking is intentionally limited to non-authoritative interactions.
Conversion events, qualification outcomes, customer outcomes, and revenue can
only be created by server code after ownership/tenant/state validation.

## Attribution lifecycle

Landing requests capture UTM source, medium, campaign, content and term, Google
and Meta click IDs, landing page, and external referring domain. A
`VisitorAttribution` row preserves:

- first touch: immutable first observed acquisition touch;
- last touch: most recent campaign, click-id, or external referral touch.

Direct/internal navigation does not erase a prior campaign. On lead creation,
both snapshots copy to the tenant-owned `Lead`; subsequent server conversion
events inherit the lead's current last-touch snapshot. Appointments and outcomes
remain connected through opaque lead/appointment IDs. Browser attribution can
never overwrite a different lead: continuing a lead requires its HMAC ownership
capability and server-stored visitor binding.

The dashboard marketing table currently reports the event's attribution
(last-touch for server conversions). Lead detail shows both first and last
touch. Future reports may add an explicit first-touch/last-touch model selector.

## Funnel calculations

The primary stages are visitors → funnel starts → leads → qualified leads →
booked inspections → completed inspections → customers won. Anonymous stages
deduplicate by visitor; identified stages deduplicate by lead. Repeated events
therefore cannot inflate a stage. Conversion is `next / previous`; abandonment
is `previous - next`, floored at zero for non-cohort range effects.

Question drop-off uses the authoritative ordered qualification definition.
Each question reports reached, completed, abandoned, and completion percentage.
Conditional questions remain in the report but only receive completion events
when their branch applies; interpretation should account for branch volume.

Date presets (today, seven days, thirty days, custom inclusive dates) are
converted from company-local calendar boundaries to UTC instants using
`Company.timezone`. PostgreSQL stores `TIMESTAMPTZ`; server/process timezone is
not used for report boundaries.

## Marketing economics

Company-entered `MarketingSpend` can be dimensioned by source, medium, campaign,
and content. Spend rows that overlap the selected range are included in full;
partial-period prorating is deliberately not fabricated. Cost per lead,
qualified lead, booked inspection, CAC, ROAS, and ROI return unavailable unless
their real numerator and denominator exist. Revenue comes only from an actual
won lead contract value. Zero is not substituted for missing spend or revenue.

## Demo and tenant isolation

`Company.isDemo` is the mode boundary copied to leads, appointments, events, and
spend. Dashboard queries require both company ID and the company's demo mode.
The seeded local company is explicitly marked demo and every owner page displays
`DEMO DATA`. Production companies default to non-demo, preventing silent mixing.

Every query is scoped by authenticated company ID. General event metadata never
contains names, email, phone, street address, raw authentication identifiers, or
qualification answer values.

## Paid advertising integrations

Google Ads and Meta Ads APIs are not connected. Adding them requires customer
accounts, OAuth/application credentials, account/campaign mapping, currency and
timezone policy, reconciliation windows, and a decision about importing spend
versus conversion uploads. Until then, spend is entered manually and click IDs
are retained only for later reconciliation.
