# Production deployment architecture

Status: provider selection is recommended but no external resources have been
created. All repository configuration in this checkpoint is provider-neutral.

## Recommendation for the pilot

Use **Render** in one US region for the first production pilot:

- one paid Node web service running `npm run start`;
- one paid managed Render Postgres database;
- one paid Render Key Value instance (Redis/Valkey compatible) configured with
  `noeviction`;
- one cron job that calls the authenticated communication-job endpoint;
- GitHub Actions as the required verification gate.

This fits the current application better than a function-first deployment. The
app uses Prisma interactive serializable transactions and ordinary Redis TCP
connections, and benefits from predictable long-lived Node processes. Render
provides all runtime components, private networking, pre-deploy commands,
health checks, logs, custom-domain TLS, and rollback controls in one operational
surface. Start with one web instance; PostgreSQL and Redis already provide the
cross-instance correctness needed when a second instance is justified.

Do not use free/sleeping services for production. They introduce cold starts,
temporary databases, or availability limits that conflict with a homeowner
booking funnel.

Official product references:

- <https://render.com/docs/deploy-nextjs-app>
- <https://render.com/docs/deploys>
- <https://render.com/docs/postgresql>
- <https://render.com/docs/key-value>
- <https://render.com/docs/cronjobs>

## Alternatives considered

| Option | Fit | Advantages | Pilot trade-offs |
|---|---|---|---|
| Vercel + managed Postgres + managed Redis | Good | Best native Next.js experience, previews, global edge, managed TLS | PostgreSQL/Redis are separate marketplace products; function connection behavior and duration limits require more care for Prisma interactive transactions; precise frequent cron requires a paid plan. |
| Render | **Recommended** | Native Node service, Postgres, Redis-compatible Key Value, cron, private network, migrations, health checks, logs and rollback together | Fewer framework-specific optimizations than Vercel; paid staging duplicates resources; operator must verify proxy/header behavior. |
| Railway | Good alternative | Fast Git deployments, Postgres/Redis templates, cron, usage-based billing, simple environments | Usage billing is less predictable; backup/PITR and deployment controls must be verified for the chosen plan; production-oriented team plan has a higher minimum. |
| Fly.io | Capable, higher operations | Excellent regional placement, Machines, health-driven deployments, managed Postgres and Upstash Redis | More networking, machine, scaling and database choices for the operator; unnecessary complexity for one local pest-control pilot. |
| Container VPS/cloud | Technically viable | Maximum control and potentially low raw compute cost | The operator owns OS patching, TLS proxy, database/Redis HA, backups, failover, monitoring, deploys and incident response. Lowest platform cost is not lowest operational risk. |

Planning estimate as of 2026-08-21: budget approximately **$30–$80/month**
for one always-on pilot application, a small paid PostgreSQL database, a small
paid Redis-compatible store, backups and a short cron job, before domain,
Sentry, SMS/email and traffic overages. A fully isolated paid staging copy can
add roughly **$20–$60/month**. These are planning ranges, not provider quotes;
confirm region, compute, storage, backup retention and current pricing before
purchase.

## Release flow

```text
GitHub pull request
  → GitHub Actions CI
  → merge to main
  → host builds the verified commit
  → one pre-deploy `npm run db:deploy`
  → start new app instance(s)
  → `/api/health/ready` succeeds
  → traffic moves to the new version
```

Configure host auto-deploy to **After CI checks pass**, not merely on commit.
The build command is `npm ci && npm run build`, pre-deploy command is
`npm run db:deploy`, and start command is `npm run start`. Next.js reads the
host-provided `PORT`; no custom server is required.

The CI workflow at `.github/workflows/ci.yml` runs with disposable PostgreSQL
17 and Redis 7 service containers. It applies and validates migrations, seeds
synthetic data, typechecks, lints, runs Vitest, runs the complete Playwright
suite (including real PostgreSQL/Redis concurrency), and produces a production
build. It never contains production credentials and has no deployment token.

## Database and migration strategy

Use a dedicated database per environment, TLS/private networking, and managed
backups. Keep application, PostgreSQL and Redis in the same region. For the
initial single web instance, use the private direct PostgreSQL URL with a
conservative Prisma connection limit below the database's connection cap.
Before adding replicas, calculate the total pool as:

```text
maximum app instances × per-process Prisma pool + migration/admin reserve
```

If a managed pooler is introduced, verify that it supports Prisma interactive
transactions and PostgreSQL serializable semantics; rerun the real concurrency
suite against that exact endpoint.

Production releases use `prisma migrate deploy`, never `migrate dev` or
`migrate reset`. Prefer backward-compatible expand/contract migrations so old
and new instances can overlap during a rolling deployment. A failed migration
stops the release and leaves the last application version serving. Application
rollback does not reverse schema: ship a forward corrective migration unless a
separately reviewed database restore is required.

## Environments

Maintain two isolated host environments:

- **staging**: separate database, Redis, secrets and owner; `Company.isDemo`
  true; synthetic data only; communications disabled; no production webhook
  credentials;
- **production**: non-demo company, production secrets and managed services;
  real customer data only after launch approval.

Do not let preview deployments point at persistent staging or production
databases by default. A preview needing integration data must receive its own
disposable resources or remain build-only.

## Domain, TLS and proxy boundary

The host terminates TLS and redirects HTTP to HTTPS. Add the pilot custom domain
only after staging smoke tests succeed. Verify the exact forwarding-header chain
before setting `RATE_LIMIT_TRUSTED_PROXY_HOPS`; leaving it unset is safer than
trusting a spoofable header. Re-test the proxy suite against captured provider
behavior.

No application file storage exists today. The app stores all durable business
data in PostgreSQL and rate-limit counters in Redis; ephemeral application
filesystems are acceptable. Add object storage only if uploads are introduced.

## Rollback

Keep the prior successful build available. On an application regression:

1. disable automatic deploys;
2. roll back to the last healthy build;
3. verify `/api/health/ready` and the booking smoke test;
4. prepare a forward fix before re-enabling deploys.

Never assume application rollback rolls back data or migrations. For a
destructive data incident, stop writes, preserve evidence, and use the tested
managed-database recovery procedure.
