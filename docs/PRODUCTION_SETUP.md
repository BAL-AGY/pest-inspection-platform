# Production setup

Production configuration is intentionally fail-closed. The application must
not start until every security-sensitive value below is present, strong, and
independent.

## Required environment variables

- `DATABASE_URL`: a TLS-enabled PostgreSQL connection string for a dedicated
  production database. See `docs/POSTGRESQL.md`.
- `AUTH_SECRET`: signs/encrypts Auth.js session material.
- `FUNNEL_CAPABILITY_SECRET`: signs anonymous homeowner lead-ownership tokens.
- `RATE_LIMIT_IDENTIFIER_SECRET`: HMAC-hashes identifiers before they enter the
  rate-limit store.
- `REDIS_URL`: authenticated shared Redis endpoint used for atomic rate-limit
  enforcement across every application instance. Use `rediss://`/TLS in
  production unless the provider supplies an equivalently protected private
  network.
- `COMMUNICATION_PROVIDER`: currently must be `disabled`; no live adapter ships
  in this checkpoint.
- `COMMUNICATION_JOB_SECRET`: independent random bearer secret used by the
  deployment scheduler for `/api/internal/communications/run`.
- `AUTH_URL`: the public canonical HTTPS origin, with no path, query, embedded
  credentials, or trailing application route (for example,
  `https://app.example.com`). It also provides Auth.js host trust; do not add a
  blanket `AUTH_TRUST_HOST=true` when `AUTH_URL` is configured.

Generate each secret independently with a cryptographically secure generator,
for example `openssl rand -base64 32`. Do not reuse a value between variables.
Production validation rejects missing values, common placeholders, values
shorter than 32 characters, and reuse between these three trust domains. Error
messages identify the invalid variable but never include its value.

Production validation also rejects a missing/malformed/non-PostgreSQL
`DATABASE_URL` and an invalid configured `RATE_LIMIT_TRUSTED_PROXY_HOPS`.

Store production values in the deployment platform's secret manager. Never put
them in `.env.example`, a committed `.env*` file, a shell script, a support
ticket, or application logs.

## First owner provisioning

`npm run db:seed` remains convenient and deterministic in development/test. In
production it refuses all default credentials and requires both:

- `SEED_OWNER_EMAIL`: the real initial owner's email, not
  `owner@example.com`.
- `SEED_OWNER_PASSWORD`: a separate initial password of at least 32 characters
  that is not a known placeholder.

Run the seed as an explicit, controlled one-time provisioning operation with
those values supplied through the deployment secret manager. Communicate the
initial password through an appropriate private channel, then remove the seed
password from the deployment environment. The seed hashes it with bcrypt,
never logs it, and uses an upsert with an empty update branch: rerunning the
seed cannot silently reset an existing owner's password.

This is initial provisioning, not a password-management system. There is not
yet an owner invitation, password-change, password-reset, MFA, or account
recovery workflow.

## Environment-file safety

`.gitignore` excludes `.env`, `.env.*`, certificates, private keys,
`credentials/`, and `secrets/`, while explicitly allowing only
`.env.example`. The example contains nonfunctional placeholders only. Before
deployment, verify with `git ls-files` that no environment or key file is
tracked. If a secret was ever committed, removing the file is insufficient:
rotate the credential at its issuer and address repository history separately.

## Startup behavior

`src/lib/environment.ts` is the centralized production validator.
`src/instrumentation.ts` invokes it during Node.js startup, and authentication
and funnel-token code invoke it again at runtime as defense in depth. A missing,
weak, placeholder, or reused production secret throws a non-secret diagnostic
and prevents service.

Development and test do not run the production-strength checks. Their existing
deterministic seed account and funnel-secret fallback remain available only
outside `NODE_ENV=production`.

Production validation also rejects a missing, malformed, or non-Redis
`REDIS_URL`. Rate-limit requests fail closed with HTTP 503 if Redis cannot
enforce a bucket; there is no production fallback to local memory. Configure
Redis authentication, TLS, monitoring/alerting, high availability, and a
memory/eviction policy that does not discard active limiter keys unexpectedly.
For local testing, `REDIS_URL=redis://localhost:6379` is sufficient; never copy
that value into production.

The deterministic communications/webhook adapters are rejected by the true
production boundary. Explicit staging may use them only with
`DEPLOYMENT_ENV=staging`, `COMMUNICATION_PROVIDER=deterministic`, and a strong
staging-only webhook secret. See `docs/STAGING.md` and `docs/COMMUNICATIONS.md` for the exact vendor,
sender, credential, webhook, and scheduler configuration still required.

## PostgreSQL release ordering

PostgreSQL is required in every environment; SQLite is no longer an active
application database. Before starting a production release:

1. Take/verify a backup or recovery point.
2. Run `npm run db:deploy` once against the production `DATABASE_URL`.
3. Confirm `prisma migrate status` reports the schema current.
4. Start the application instances with the same database URL and validated
   security secrets.

Do not run `prisma migrate dev` in production. Configure TLS and a connection
pool sized for the database limit and replica count. Serverless or highly
replicated deployments should use a Prisma-compatible pooled endpoint that
preserves interactive transaction semantics. Restore testing and provider
failover verification remain deployment responsibilities. Full migration and
booking-concurrency details are in `docs/POSTGRESQL.md`.

## Deployment and operations

The recommended but unprovisioned pilot topology, CI/release sequence,
connection-pool guidance, staging isolation and rollback procedure are in
`docs/DEPLOYMENT.md`. Health checks, alerts, scheduler operation and backup/
restore expectations are in `docs/OPERATIONS.md`.
