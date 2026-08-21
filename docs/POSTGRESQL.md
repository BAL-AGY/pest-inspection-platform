# PostgreSQL architecture and verification

PostgreSQL is the application database for development, integration testing,
and production. `prisma/schema.prisma` uses `provider = "postgresql"`; active
migrations live in `prisma/migrations/`. The former SQLite migrations are kept
only as an auditable archive in `prisma/migrations-sqlite/` and must never be
passed to `prisma migrate deploy`.

## Local setup

Use PostgreSQL 17 or a currently supported compatible release. Create a
disposable development/test database without committing credentials:

```sh
createdb pest_inspection_test
export DATABASE_URL='postgresql://LOCAL_USER@localhost:5432/pest_inspection_test'
npm run db:deploy
NODE_ENV=development npm run db:seed
```

For password-authenticated local installations, put the password in an ignored
`.env` file or local secret manager. Do not add it to scripts or documentation.
The test database must permit concurrent connections. Run the database-specific
proof with:

```sh
npm run test:postgres:concurrency
```

## Migration strategy

The SQLite-generated SQL history was not PostgreSQL-compatible (`DATETIME`,
SQLite table/primary-key forms, and provider-locked migration metadata).
Production had not been deployed, so the cutover establishes one fresh
PostgreSQL baseline rather than pretending the SQLite SQL can be replayed.
That baseline uses PostgreSQL foreign keys, booleans, double precision, and
`TIMESTAMPTZ(3)` for stored instants. JSON-shaped configuration remains text to
preserve the existing application/data-model contract; converting it to
`jsonb` is a separate future optimization, not required for correctness.

The active-slot partial unique index is hand-authored in the baseline because
Prisma cannot declare partial indexes in its schema DSL:

```sql
CREATE UNIQUE INDEX "Appointment_companyId_scheduledStart_active_key"
ON "Appointment"("companyId", "scheduledStart")
WHERE "status" IN ('booked', 'rescheduled');
```

CI/deployment must use `npm run db:deploy` (`prisma migrate deploy`), never
`prisma migrate dev`. Apply migrations as a release step before starting new
application instances. Take and verify a database backup before migrations;
use the managed provider's point-in-time recovery where available. Test a
restore periodically—an untested backup is not a recovery plan.

## Booking concurrency guarantee

Every booking and reschedule performs its authoritative capacity/conflict read
and write in a PostgreSQL `SERIALIZABLE` transaction. PostgreSQL Serializable
Snapshot Isolation detects concurrent predicate/read-write conflicts even when
two requests target different rows. Prisma reports the losing transaction as
`P2034`.

`runSerializableTransaction()` retries only `P2034`, at most three total
attempts, with short jitter. Each retry reruns the complete callback, including
the capacity query. The loser therefore observes the winner's committed row and
returns the appropriate business conflict instead of exceeding capacity.
Uniqueness (`P2002`), validation errors, and other database failures are never
retried. An exhausted serialization conflict returns HTTP 409 rather than being
hidden or retried indefinitely.

Same-start correctness has two independent layers:

1. Serializable read/check/write behavior.
2. The partial unique database index, which is the final atomic guard across
   every application process and instance.

Daily capacity cannot be represented by a simple unique constraint because it
is a company-local-day count. Serializable predicate reads over the
company-local UTC range provide that invariant across instances. The real
PostgreSQL route suite proves the `capacity - 1` race using simultaneous
different-time requests and verifies the persisted count.

Rescheduling updates the existing appointment in the same serializable
transaction that validates destination capacity. A failed transaction rolls
back, preserving the original slot. Cancellation changes status to inactive;
the partial index and capacity queries both ignore inactive statuses, so the
slot/capacity becomes reusable.

## Timezone semantics

All instants are stored as `TIMESTAMPTZ(3)` and exchanged as UTC ISO-8601
values. Business-day bounds are still computed from `Company.timezone` by
`src/lib/timezone.ts`, then passed to PostgreSQL as absolute `[start, end)`
ranges. Database/server/session timezone settings do not define business days.
The PostgreSQL suite groups persisted rows with the same company-local helper,
including appointments whose UTC date differs from their local date.

## Connection expectations

Use a TLS-enabled production connection supplied by the managed PostgreSQL
provider. Prisma uses a connection pool per application process, so size the
pool against database connection limits and the maximum number of application
instances. For serverless/high-replica deployment, use the provider's
Prisma-compatible pooled endpoint or a transaction-pooling proxy known to
support interactive transactions. Serializable transactions must not be routed
across different physical database sessions mid-transaction.

## Known limitations

- PostgreSQL 17.11 was verified locally; no managed production vendor has been
  selected or exercised.
- The migration proves a fresh database, not an automated transfer of an old
  SQLite development database. Local SQLite data is disposable and is not
  imported.
- The current company-wide calendar has no per-inspector capacity rules.
- Serializable retries protect correctness but sustained hot-day contention
  can return 409 after three conflicts; monitor conflict rates.
- Backup/restore, failover, TLS, pooling, and observability require validation
  against the eventual managed provider.
