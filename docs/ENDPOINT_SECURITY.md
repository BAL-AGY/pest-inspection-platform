# Endpoint Security

Status: documents the actual endpoint classification and rate-limiting
controls implemented in `src/lib/rate-limit.ts` and the route handlers.

## Endpoint classification

| Endpoint | Method | Classification | Controls |
|---|---|---|---|
| `/api/leads` | POST | Public write | Strict Zod envelope, centralized qualification schema/progression, server scoring, create/continue rate policy, capability required for continuation |
| `/api/track` | POST | Public write | Zod, tracking rate policy; lead association remains informational/unverified |
| `/api/availability` | GET | Public lead-scoped read | Capability, availability rate policy, server-rederived qualification/eligibility gate |
| `/api/appointments` | POST | Public lead-scoped write | Capability, booking rate policy, server-rederived qualification/eligibility gate, server slot validation, atomic DB constraint |
| `/api/auth/**` | POST | Public authentication write | Auth.js plus auth rate policy |
| `/api/auth/**` | GET | Public authentication read | Auth.js-managed flows |
| `/api/webhooks/communications/[provider]` | POST | Public provider write | Adapter-owned signature/timestamp verification, strict schema, shared rate policy, provider-event idempotency, server-side provider-account tenant mapping |
| `/api/internal/communications/run` | POST | Internal/server-only write | Timing-safe bearer secret; database-idempotent message keys |
| `/api/leads` | GET | Authenticated read | Session + company scope |
| `/api/leads/[id]` | GET | Authenticated read | Session + company scope |
| `/api/leads/[id]` | PATCH | Authenticated write | Session + company scope + Zod |
| `/api/leads/[id]/notes` | POST | Authenticated write | Session + company/lead scope + Zod |
| `/api/appointments` | GET | Authenticated read | Session + company scope |
| `/api/appointments/[id]` | PATCH | Authenticated write | Session + company/appointment scope + Zod |
| `/api/marketing-spend` | GET/POST | Authenticated read/write | Session + company scope + Zod on write |
| `/api/analytics/funnel` | GET | Authenticated read | Session + company scope |
| `/api/dashboard/metrics` | GET | Authenticated read | Session + company scope |
| Dashboard Server Actions | POST to page routes | Internal authenticated writes | Page/session checks; not public API policies |

## Central rate limiter

`src/lib/rate-limit.ts` owns policies, identifier hashing, `429` responses,
trusted-proxy parsing, and the `RateLimitStore` interface. Route handlers do
not maintain their own counters.

| Policy | Limit | Window | Primary identifier |
|---|---:|---:|---|
| New lead creation | 6 | 1 hour | visitor + trusted network |
| Existing lead continuation | 30 | 10 minutes | verified lead + trusted network |
| Tracking | 120 | 1 minute | visitor + trusted network |
| Availability | 40 | 5 minutes | verified lead + trusted network |
| Booking attempts | 12 | 15 minutes | verified lead + trusted network |
| Auth POST actions | 10 | 15 minutes | normalized account/CSRF session + trusted network |
| Communication webhooks | 600 | 1 minute | verified provider account + trusted network |

Each policy also has a higher shared emergency ceiling so rotating
visitor identifiers cannot create an entirely unbounded request stream on a
single instance. Booking remains protected independently by database
transactions and the partial unique active-slot index.

## Identifier privacy and proxy trust

Raw visitor IDs, lead IDs, account identifiers, cookie values, and network
addresses never become store keys. They are converted to HMAC-SHA256 digests.
Set `RATE_LIMIT_IDENTIFIER_SECRET` to a stable random secret when using a
shared production store; otherwise a random per-process salt is used.

Forwarding headers are ignored by default because clients can spoof them.
Set `RATE_LIMIT_TRUSTED_PROXY_HOPS` only after verifying that the deployment's
trusted proxy chain overwrites/appends `X-Forwarded-For` predictably. If it is
unset or invalid, visitor/lead/account and emergency-global buckets still
apply, but network-level isolation does not.

## `429` and backend-failure behavior

Limited requests return HTTP 429, JSON `error: "rate_limited"`, a whole-second
`Retry-After`, and `Cache-Control: no-store`. Checks run before state-changing
database operations. Capability-bound limits run after capability verification
so a leaked lead ID cannot be used to exhaust the homeowner's bucket.

If Redis cannot atomically enforce a request, protected routes fail closed
with HTTP 503, `error: "rate_limit_unavailable"`, `Retry-After: 30`, and
`Cache-Control: no-store`. They do not fall back to an instance-local counter
or proceed unlimited. The response does not reveal connection details.

## Backing store and production operation

Production requires `REDIS_URL` and uses `RedisRateLimitStore`. A Lua script
atomically increments each fixed-window bucket, applies expiry on first use,
and returns a reset instant derived from Redis server time. All application
instances therefore share counters without relying on process clocks. Keys
contain only an HMAC digest and a non-sensitive namespace prefix.

`InMemoryRateLimitStore` remains a development/test fallback only when
`REDIS_URL` is absent. Redis availability, latency, memory/eviction policy,
persistence, TLS/authentication, and regional topology remain deployment
responsibilities. The fixed-window policy is intentionally conservative near
window boundaries; rate limiting never replaces database booking constraints.
