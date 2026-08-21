# Customer communications

Status: provider-neutral production architecture is implemented. No live SMS
or email vendor is connected, and no real message is sent by this repository.

## Provider boundary

`CommunicationProvider` owns outbound acceptance; `CommunicationWebhookAdapter`
owns provider-specific signature verification and payload normalization. Route
and business code use only normalized messages/events. The deterministic
adapter performs no network I/O and does not log recipient or message content.
It is available outside production and in the explicit
`DEPLOYMENT_ENV=staging` boundary, where production-strength validation requires
`COMMUNICATION_PROVIDER=deterministic` plus a staging-only webhook secret. True
production accepts only `COMMUNICATION_PROVIDER=disabled`, so staging
simulation cannot silently become real delivery. Staging UI is visibly labeled
`MESSAGES SIMULATED`.

`CommunicationProviderAccount` maps a provider-owned account/sender to exactly
one Company. It stores routing identifiers, never API credentials. Provider
credentials belong in the deployment secret manager and will be read only by a
future adapter.

## Outbound lifecycle and idempotency

`sendIfAllowed()` is the only outbound orchestration entry point. It:

1. resolves the selected provider/account;
2. evaluates durable suppression and authoritative channel consent;
3. atomically reserves a company-scoped `dedupeKey` in PostgreSQL;
4. writes `attempted` before calling the provider;
5. records `accepted` or `failed` after the provider response;
6. writes corresponding communication funnel events.

The database uniqueness constraint on `(companyId, dedupeKey)` prevents two
application instances from sending the same automation occurrence. A database
logging/reservation failure fails closed: the provider is not called. Provider
acceptance is never called delivery; only an authenticated delivery webhook may
set `delivered`.

Current deterministic keys cover booking confirmation, reschedule,
cancellation, 24-hour reminder, and one qualified-not-booked follow-up per
channel. `/api/internal/communications/run` is an authenticated scheduler entry
point. The deployment scheduler must send `Authorization: Bearer
$COMMUNICATION_JOB_SECRET`; repeated runs are safe.

## Consent and suppression

Operational appointment email/SMS consent and marketing email/SMS consent are
separate Lead fields. Each grant preserves its timestamp and source
(`public_funnel`). Consent is unchecked by default in the browser. All sends
require channel consent; marketing sends additionally require the corresponding
marketing consent.

`SuppressionEntry.scope` distinguishes `marketing` from `all`. Marketing-only
email unsubscribe blocks marketing but may leave explicitly consented
transactional email available. SMS STOP creates `scope=all`, clears SMS and SMS
marketing consent for every matching normalized contact in the company, and
immediately blocks all future automated SMS. CRM blanket opt-out suppresses all
channels. Suppression is company-scoped and survives new Lead/visitor records.

## Inbound and delivery webhooks

`POST /api/webhooks/communications/[provider]` passes the raw request to the
selected adapter. The deterministic test adapter demonstrates the required
contract: HMAC verification over timestamp plus exact raw body, timing-safe
comparison, a five-minute past/future replay window, and strict event schema.
Live adapters must implement the selected vendor's official signature scheme;
the route contains no universal/fabricated vendor assumptions.

Verified events are serialized with a PostgreSQL advisory transaction lock and
deduplicated by `(provider, providerEventId)`. Delivery correlation is scoped by
the provider-account Company mapping and provider message ID. A valid event for
one account cannot mutate another company's message. Inbound senders are matched
against normalized company-scoped Lead contact fields. Duplicate STOP events do
not duplicate suppression or inbound communication records.

Inbound reply bodies are persisted because reply handling requires their
content. They are sensitive customer data: production needs retention/access
policies and should avoid copying bodies into logs or analytics metadata.

## Analytics events

The communication lifecycle writes:

- `communication_attempted`
- `communication_accepted`
- `communication_delivered`
- `communication_failed`
- `communication_bounced`
- `communication_inbound`
- `communication_opted_out`

Each event references a lead and carries only communication ID, provider event
ID where applicable, channel, and purpose—not body content. Webhook idempotency
and outbound dedupe make distinct-lead/stage calculations possible without
counting provider retries as additional contacts. Existing acquisition funnel
conversion order is unchanged.

## Live-provider work still required

Choose SMS and email vendors, create test/production accounts, provision sender
phone number/email domain, complete required carrier/domain verification, and
provide secret-manager values for their API credentials and webhook-verification
secrets. Then implement one outbound provider and webhook adapter per vendor,
add the provider names to production environment validation, create Company
provider-account mappings, register callback URLs, and run vendor sandbox tests.
No credentials or live adapters are included in this checkpoint.
