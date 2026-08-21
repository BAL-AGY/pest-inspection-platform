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
| `AUTH_TRUST_HOST` | Required on Render | No | `true` | Set only behind the selected trusted host/proxy |
| `DEFAULT_COMPANY_SLUG` | Optional for current single tenant | No | `demo-pest-control` | Keep staging pointed at demo company; production uses its own slug |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | Optional; leave unset initially | No | positive integer such as `1` | Set only after verifying Render's actual proxy chain |
| `SEED_OWNER_EMAIL` | Required only while manually provisioning owner | Yes (account identifier) | `owner@staging.example` | Unique staging identity; never use development or production owner |
| `SEED_OWNER_PASSWORD` | Required only while manually provisioning owner | Yes | independently generated 32+ character password | Staging-only; remove from Render after seed succeeds |
| `STAGING_DEMO_CONFIRM` | Required for staging seed/reseed commands | No | `demo-pest-control` | Exact guard; do not configure in production |

No `NEXT_PUBLIC_*` base URL is currently used. Do not add database, Redis,
provider, owner, or signing secrets with a `NEXT_PUBLIC_` prefix. Twilio,
Resend, or other live provider variables must remain absent. The staging build
rejects live communication provider modes.

## Render service commands

- Build: `npm ci && npm run build`
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
