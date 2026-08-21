# Engineering Autopilot Runbook

## Objective

Continue building this pest-control acquisition platform toward a
**client-demo-ready and pilot-ready** state. The primary business journey is:

```text
Traffic → Landing Page → Qualification → Qualified Lead
→ Booked Free Home Inspection → Owner Dashboard → Inspection Completed
→ Customer Won/Lost → Cost / Conversion / CAC / ROI reporting
```

Backend tests alone do not make the product finished. The next major milestone
is a real browser journey in which a homeowner qualifies and books, and staff
can then see that exact lead, qualification, attribution, appointment, pipeline
state, and related metrics.

This runbook supplements `CLAUDE.md`, `AGENTS.md`, `TASKS.md`, and the binding
architecture in `docs/`. Read those sources before changing the project and
preserve their security, consent, tenancy, booking, timezone, and data-integrity
decisions.

## Autonomously allowed actions

Without additional approval, the active engineer may:

- read repository files and inspect Git history, status, and diffs;
- edit in-scope files, refactor for correctness, create tests, and update docs;
- run typecheck, lint, unit/integration tests, Playwright, PostgreSQL tests,
  Redis tests, local development servers, and production builds;
- run non-destructive migrations against disposable local test databases;
- fix bugs discovered within the active milestone and continue through repeated
  implementation/test/fix cycles.

## Stop and ask before

Stop before:

- deploying publicly or changing the material product objective;
- sending real SMS/email or connecting/charging a live advertising account;
- spending money, purchasing services, or creating external accounts;
- using real customer data or unprovided real secrets;
- deleting production data;
- destructive Git history rewriting, force-pushing, or risky merging over known
  production work.

## Git checkpoint rule

After each major milestone:

1. Run the full verification policy below.
2. Stage only intended files and scan the staged diff for secrets, credentials,
   environment files, generated data, local database files, build/test artifacts,
   and machine-specific paths.
3. Create one descriptive **local** checkpoint commit.
4. Do **not** push automatically.
5. Continue to the next milestone when no external blocker exists.

When stopping, report every local commit not pushed to origin.

## Disposable local services

- PostgreSQL: `postgresql://camilodaza@localhost:5432/pest_inspection_test`
- Redis: `redis://localhost:6379`

These are local disposable development/test services only. Never present or
commit them as production credentials.

## Current priority: demo readiness

Do not remain in infrastructure-hardening work indefinitely. Close real-user
demo gaps in this order.

### Milestone A — Manual homeowner journey

Make the following reliable in a real browser:

```text
localhost:3000 → Get My Free Inspection → qualification → contact details
→ service-area check → qualified outcome → availability → booking → confirmation
```

Malformed or failed API responses must never crash the frontend. Errors must be
useful and homeowner-safe. Playwright must match the real manual path.

### Milestone B — Staff / owner experience

Verify that an owner can log in and see the newly created lead, qualification
answers, score, MQL/SQL state, pest and property details, provider/switcher
state, attribution, booked inspection, and calendar entry; then complete the
inspection, mark the customer won/lost, add/view notes, and review activity.
Fix anything that prevents that journey.

### Milestone C — Demo economics

Support a realistic, deterministic demo of marketing spend; lead, qualified,
booked, completed, and won counts; lead-to-qualified, qualified-to-booked, show,
and close rates; CPL, cost per qualified lead, cost per booked inspection, CAC,
attributed contract value, and ROAS/ROI where defined. Label demo/test data and
never fabricate production performance.

### Milestone D — Attribution

Verify UTM/source/campaign flow from landing visit through lead, appointment,
customer outcome, and dashboard analytics without duplicate counting.

### Milestone E — Product polish

Make the funnel and dashboard credible for a pest-control client demo: clear
layout, mobile usability, obvious CTAs, readable metrics, clean appointments,
and useful lead detail. Avoid cosmetic perfection at the expense of behavior.

### Milestone F — Production readiness audit

After the demo works, return to live communications providers/webhooks,
managed PostgreSQL/Redis, deployment, CI, backups, monitoring, analytics
correctness, and live advertising integrations. For provider decisions, stop
and state exactly which account, credential, or business choice is required.

## Test policy

After every material milestone run:

- `npx tsc --noEmit`;
- `npm run lint`;
- the complete unit/integration suite;
- relevant real PostgreSQL and Redis tests;
- the complete Playwright suite;
- a production build;
- `git diff --check`.

Do not claim success while any required verification is failing.

## Bug policy

For every discovered bug: reproduce it, identify the root cause, fix the
underlying issue, add a regression test, run the affected suite, and continue.
Do not merely suppress the visible symptom.

## Autopilot completion condition

Continue until either:

1. the client-demo milestone works end-to-end and all local verification
   passes; or
2. a true external blocker requires live credentials, an external account,
   payment, production infrastructure choice, user-supplied business
   configuration, or a destructive/external action.

When stopping, report what works, exact homeowner and owner demo steps, local
unpushed commits, remaining blockers, required external accounts/credentials,
and the recommended next action.
