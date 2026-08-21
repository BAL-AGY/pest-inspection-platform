# Pilot operations and recovery

## Health checks

- `GET /api/health/live` proves the Next.js process can serve HTTP. It performs
  no dependency calls and returns only `{ "status": "ok" }`.
- `GET /api/health` is the stable host-facing aggregate check. It returns only
  `healthy`/`unhealthy`, without naming an unavailable dependency.
- `GET /api/health/ready` checks PostgreSQL with `SELECT 1` and Redis with
  `PING`, each with a short timeout. It returns 200/`ready` only when both are
  usable, otherwise 503/`not_ready`.

Both responses are `Cache-Control: no-store` and expose no URLs, credentials,
versions, database names or exception messages. Structured failure logs contain
dependency categories only. Configure the deployment health gate and an
external HTTPS uptime probe against readiness; use liveness for diagnosis.

PostgreSQL unavailable means the app cannot safely read or mutate its source of
truth; readiness fails and database-backed routes fail. Redis unavailable means
public protected routes deliberately return 503 instead of becoming unlimited;
readiness also fails. Startup configuration errors throw before requests are
served. A failed migration stops deployment before new instances receive
traffic.

## Logging and error monitoring

Next.js `onRequestError` emits one-line JSON with timestamp, route template,
method, route type, error class and optional digest. It deliberately omits the
raw URL/query, headers, request body, exception message and stack because those
can contain homeowner PII or credentials. Platform access/deploy logs and
PostgreSQL/Redis provider metrics remain separate operational sources.

For a pilot, alert on:

- readiness or external uptime failure;
- HTTP 5xx rate and unhandled `server_request_failed` events;
- booking 409/P2034 conflict growth and booking-route 5xx responses;
- `Communication.status = failed` growth and webhook 4xx/5xx responses;
- PostgreSQL connection, storage, CPU and slow-query pressure;
- Redis errors, latency, memory pressure and rejected writes;
- spikes in 429 or `rate_limit_unavailable` responses;
- failed CI, migration, deploy or scheduled-job runs.

Sentry (or an equivalent error service) is appropriate once an account and data
handling decision exist. Configure server-side capture first, disable request
bodies and PII by default, scrub headers/query strings, set environment/release,
and verify retention/access. Do not add a DSN until the user selects and creates
the account. The structured hook is the provider-neutral fallback meanwhile.

## Scheduled communications

The app has no continuous worker or queue today. A scheduler should POST to
`/api/internal/communications/run` with the independent
`COMMUNICATION_JOB_SECRET`. Run it every 15 minutes initially; selection and
message dedupe are PostgreSQL-backed, so retries are safe. The scheduler must
alert on non-2xx results and must never log its Authorization header.

Staging keeps `COMMUNICATION_PROVIDER=deterministic`, which performs no network
I/O and records simulated provider acceptance. It is protected by the explicit
staging boundary and staging-only webhook secret. When live adapters are added,
provider webhooks target the public HTTPS route and must pass the adapter's
signature/replay checks. Provider delivery attempts are never inferred from a
200 health check or scheduler invocation.

## Backup and recovery expectations

Before real customer data, select a paid PostgreSQL tier with automated backups
and point-in-time recovery if available. Pilot targets:

- provider recovery points covering at least the previous 7 days (Render's
  documented PITR window requires a Pro-or-higher workspace for seven days;
  Hobby currently provides three);
- a recovery point objective no worse than 24 hours, with a target of one hour
  when provider PITR supports it;
- a documented restore to a **new** staging database at least quarterly and
  before launch;
- a verified backup/recovery point immediately before higher-risk migrations;
- restricted backup access and encryption in transit/at rest.

These are requirements to verify, not guarantees made by this repository.
Record the selected provider plan's actual retention, RPO/RTO and restore steps.
If business retention must exceed the native PITR window, add encrypted logical
exports to separately controlled object storage as a later approved external
service; do not claim the platform's short PITR window provides long-term
retention.
Redis holds expiring rate-limit counters, not the business source of truth; it
does not require application-level backup for recovery. Redis loss temporarily
fails public protected actions closed until the shared store recovers.

For pilot recovery: create a new database from the chosen restore point, run
`prisma migrate status`, connect a staging instance, perform homeowner/owner
smoke tests, then approve the production connection switch. Never test restore
by overwriting the live database.

## Pilot runbook

Before deployment:

1. CI is green for the exact commit.
2. Production secrets pass startup validation.
3. A current backup/recovery point exists.
4. `npm run db:deploy` and `npm run db:status` succeed.
5. The new instance returns readiness 200.
6. Run a synthetic staging funnel, booking and owner-dashboard smoke test.

After deployment, watch errors, database/Redis health, booking failures,
communications failures and rate-limit behavior for at least 30 minutes. Do not
send real communications until live providers and webhook verification have a
separate approved checkpoint.
