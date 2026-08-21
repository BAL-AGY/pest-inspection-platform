# Live acquisition readiness

This is the launch gate after the synthetic Render staging walkthrough passes.
It does not claim legal compliance, provider readiness, or production results.

## P0 — blocks Demetrius from testing the prototype

- Create the Render Web Service in the same region as the existing staging
  Postgres and Key Value resources, attach their internal URLs, and configure
  the staging matrix in `docs/STAGING.md`.
- Select private staging owner credentials, run the explicit migration/seed
  commands, then remove the seed credential variables.
- Run `npm run staging:smoke` and the complete manual homeowner/owner journey
  in `docs/STAGING_DEMO.md` against the assigned HTTPS hostname.

There is no known repository-side P0 after this checkpoint. The remaining P0
work changes external Render configuration and therefore requires operator
action and the actual resource region/URLs.

## P1 — blocks real paid acquisition traffic

- Replace the demo tenant with the real company's reviewed branding, service
  ZIPs, timezone, business hours, inspection duration, inspector roster, and
  daily capacity; provision a non-demo owner with a privately delivered
  credential.
- Choose SMS and email vendors, create verified sender identities, implement
  the live adapters, configure authenticated delivery/inbound webhooks, and
  acceptance-test confirmations, reminders, failures, STOP, and suppression.
- Obtain counsel-reviewed privacy notice, terms, consent language, retention
  policy, and TCPA/CAN-SPAM/state-law process appropriate to the business and
  acquisition channels.
- Provision isolated production Postgres, Key Value, and Web Service resources;
  enable managed backups/PITR, complete a restore drill, configure error and
  uptime monitoring, alerts, log retention, and an incident contact.
- Validate the custom domain/TLS, Render proxy boundary, rate limits, session
  cookies, database pool sizing, and full journey in production with synthetic
  records before accepting real data.
- Define the initial Google Ads/Meta conversion workflow. UTM, `gclid`, and
  `fbclid` attribution are preserved today, but there is no ad-platform
  conversion upload or API-based spend ingestion. Manual spend entries are not
  a substitute for reconciled campaign costs.

## P2 — required before scaling

- Add owner password rotation/reset, account recovery, MFA, and finer-grained
  staff roles; perform a focused external penetration test.
- Move scheduled communication work to a durable queue with dead-letter and
  replay operations; add provider reconciliation and delivery-latency alerts.
- Load-test the exact managed PostgreSQL/Redis endpoints and pooler, then set
  autoscaling and database connection budgets from measurements.
- Add automated ad-spend and conversion integrations, attribution
  reconciliation, longer-term analytics validation, audit retention, SLOs,
  incident runbooks, and disaster-recovery exercises.
- Complete two-company end-to-end tenant isolation before onboarding a second
  independent company.
