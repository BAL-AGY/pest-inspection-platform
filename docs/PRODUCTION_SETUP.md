# Production setup

Production configuration is intentionally fail-closed. The application must
not start until every security-sensitive value below is present, strong, and
independent.

## Required environment variables

- `DATABASE_URL`: the production database connection string. The documented
  PostgreSQL cutover must be completed before deployment.
- `AUTH_SECRET`: signs/encrypts Auth.js session material.
- `FUNNEL_CAPABILITY_SECRET`: signs anonymous homeowner lead-ownership tokens.
- `RATE_LIMIT_IDENTIFIER_SECRET`: HMAC-hashes identifiers before they enter the
  rate-limit store.

Generate each secret independently with a cryptographically secure generator,
for example `openssl rand -base64 32`. Do not reuse a value between variables.
Production validation rejects missing values, common placeholders, values
shorter than 32 characters, and reuse between these three trust domains. Error
messages identify the invalid variable but never include its value.

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
