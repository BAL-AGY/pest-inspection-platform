# Staging configuration and launch checklist

Staging is an isolated, synthetic-data environment. It uses Render's normal
production Node runtime (`NODE_ENV=production`) with
`DEPLOYMENT_ENV=staging`. It must have its own PostgreSQL database, Redis
instance, security secrets, owner login, and URL. Nothing here is a production
credential.

## Environment variables

| Variable | Requirement | Secret | Placeholder format | Isolation rule |
|---|---|---:|---|---|
| `NODE_ENV` | Required; Render normally sets it | No | `production` | Same runtime value as production |
| `DEPLOYMENT_ENV` | Required | No | `staging` | Production must use `production` or omit it (which defaults to production) |
| `DATABASE_URL` | Required | Yes | Render internal PostgreSQL connection string | Dedicated staging DB; never share development or production |
| `REDIS_URL` | Required | Yes | Render internal Key Value connection string | Dedicated staging store; never share production |
| `AUTH_SECRET` | Required | Yes | independent output of `openssl rand -base64 32` | Different from development, production, and every other secret |
| `FUNNEL_CAPABILITY_SECRET` | Required | Yes | independent random value, 32+ characters | Different from development, production, and `AUTH_SECRET` |
| `RATE_LIMIT_IDENTIFIER_SECRET` | Required | Yes | independent random value, 32+ characters | Different per environment; never reuse another secret |
| `COMMUNICATION_JOB_SECRET` | Required | Yes | independent random value, 32+ characters | Staging-only scheduler bearer token |
| `COMMUNICATION_TEST_WEBHOOK_SECRET` | Required in staging | Yes | independent random value, 32+ characters | Staging deterministic webhook signing only; never production |
| `COMMUNICATION_PROVIDER` | Required | No | `deterministic` | Staging must use `deterministic`; production currently must use `disabled` |
| `AUTH_URL` | Required for deployed staging auth | No | `https://SERVICE-NAME.onrender.com` | Staging URL only; change for production/custom domain |
| `DEFAULT_COMPANY_SLUG` | Optional for current single tenant | No | `demo-pest-control` | Keep staging pointed at demo company; production uses its own slug |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | Optional; leave unset initially | No | positive integer such as `1` | Set only after verifying Render's actual proxy chain |
| `SEED_OWNER_EMAIL` | Required only while manually provisioning owner | Yes (account identifier) | `owner@staging.example` | Unique staging identity; never use development or production owner |
| `SEED_OWNER_PASSWORD` | Required only while manually provisioning owner | Yes | independently generated 32+ character password | Staging-only; remove from Render after seed succeeds |
| `STAGING_DEMO_CONFIRM` | Required for staging seed/reseed commands | No | `demo-pest-control` | Exact guard; do not configure in production |

No `NEXT_PUBLIC_*` base URL is currently used. Do not add database, Redis,
provider, owner, or signing secrets with a `NEXT_PUBLIC_` prefix. Twilio,
Resend, or other live provider variables must remain absent. The staging build
rejects live communication provider modes.

`AUTH_URL` establishes Auth.js's canonical origin and host trust. Do not add
`AUTH_TRUST_HOST=true`: it is redundant when `AUTH_URL` is set and would trust
arbitrary forwarded host values if the canonical URL were accidentally removed.

Generate each application-owned secret independently. Run the same command
once per secret and paste each result directly into a different Render secret
field; do not reuse output:

```bash
openssl rand -base64 48
```

## Exact Render Web Service configuration

| Render field | Value |
|---|---|
| Name | `pest-inspection-staging` (or the nearest available name; then use the hostname Render assigns in `AUTH_URL`) |
| Repository | `BAL-AGY/pest-inspection-platform` |
| Branch | `main` |
| Region | **The exact region already used by both staging Postgres and Key Value** |
| Root directory | blank (repository root) |
| Runtime | Node |
| Node version | `22.22.0`, pinned by `.node-version` |
| Build command | `npm ci --include=dev && npm run build` |
| Pre-deploy command | `npm run db:deploy` |
| Start command | `npm run start` |
| Health check path | `/api/health` |
| Auto-deploy | after GitHub CI checks pass |
| Instance count | 1 initially |
| Plan | paid Starter Web Service; move to Standard only if measured memory/CPU requires it |

Render pre-deploy commands require a paid Web Service. The web service,
PostgreSQL, and Key Value resources must share one region so their private
internal URLs work. If the two existing data resources are in different
regions, stop and relocate/recreate one before creating the web service.
Use Render's **internal** database and Key Value URLs, never their external
URLs, for the Web Service variables.

The explicit `--include=dev` is required because `NODE_ENV=production` is
available during Render builds and npm would otherwise be allowed to omit
TypeScript/Tailwind build dependencies. `postinstall` generates Prisma Client;
the pre-deploy command only applies committed migrations. Startup never seeds.

## Render service commands

- Build: `npm ci --include=dev && npm run build`
- Pre-deploy: `npm run db:deploy`
- Start: `npm run start`
- Health check: `/api/health`

Migrations are the only automatic pre-deploy database mutation. Web startup
never resets or seeds data. After the first successful migration, use a Render
Shell or one-off job to provision staging explicitly:

```bash
npm run db:seed
npm run db:staging:demo
```

Both commands use the Web Service environment. Owner provisioning requires
the three temporary variables `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, and
`STAGING_DEMO_CONFIRM`. Remove both owner credential variables after success;
the seed's empty update branch never resets an existing password.

To replace only the demo tenant's activity with deterministic fixtures:

```bash
npm run db:staging:reseed
```

This destructive command refuses to run unless `DEPLOYMENT_ENV=staging`, the
target Company exists with `isDemo=true`, and
`STAGING_DEMO_CONFIRM=demo-pest-control`. It preserves the Company, owner, and
inspector, deletes that demo tenant's activity, then recreates synthetic leads,
appointments, events, attribution, revenue, and spend. It cannot target a
non-demo company and must never be added to startup or pre-deploy commands.
The demo seed also recreates deterministic SMS and email provider-account rows,
so signed delivery/STOP webhook tests remain associated with the demo tenant
after every reset without enabling any network sender.

After deployment, an operator can run the non-mutating repository smoke check
from a trusted machine:

```bash
STAGING_BASE_URL="https://SERVICE-NAME.onrender.com" npm run staging:smoke
```

This checks the staging banner plus application, PostgreSQL, and Redis health.
`STAGING_BASE_URL` is an operator-only shell variable, not a Render service
secret. Continue with `docs/STAGING_DEMO.md` for the full mutating journey.

## Post-deploy health checklist

- [ ] `/` loads over HTTPS without console/runtime errors.
- [ ] `/api/health/live` returns `200 {"status":"ok"}`.
- [ ] `/api/health`, and `/api/health/ready`, return 200 (PostgreSQL and Redis reachable).
- [ ] `npm run db:status` reports every migration applied.
- [ ] The staging owner can sign in and sees `STAGING`, `DEMO DATA`, and `MESSAGES SIMULATED`.
- [ ] The complete homeowner flow qualifies and books a synthetic homeowner.
- [ ] The booking survives a Web Service restart and appears in owner pipeline/calendar.
- [ ] Dashboard funnel and attribution metrics update after the new journey.
- [ ] A controlled burst receives `429` and `Retry-After` without a protected write.
- [ ] Communication rows/events persist with provider `deterministic`; no network SMS/email occurs.
- [ ] The deterministic signed webhook endpoint accepts a valid staging test and rejects a forged signature.
- [ ] No Twilio/Resend/live-provider credential exists in the staging service.
- [ ] Browser source/network responses contain no secrets, connection URLs, raw credentials, or stack traces.
- [ ] PostgreSQL data remains after restart; Redis rate limits are shared across instances/restarts as expected.
