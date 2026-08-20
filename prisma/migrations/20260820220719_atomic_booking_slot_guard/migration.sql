-- DropIndex
DROP INDEX "Appointment_inspectorId_scheduledStart_key";

-- Atomic double-booking guard. The previous unique index was scoped to
-- (inspectorId, scheduledStart), but every booking today has
-- inspectorId = NULL (no per-inspector calendars exist yet), and SQL
-- unique indexes treat NULLs as distinct — so that constraint never
-- actually fired for the real, common case. This partial unique index is
-- scoped to (companyId, scheduledStart) instead, matching the app's
-- actual single-shared-calendar model, and is filtered to only the
-- "active" appointment statuses so a cancelled appointment doesn't
-- permanently block re-booking that same slot. Not expressible as a
-- Prisma `@@unique` (no filtered/partial-index construct in the schema
-- DSL) — see prisma/schema.prisma's comment on the Appointment model and
-- docs/ARCHITECTURE.md. This exact syntax (CREATE UNIQUE INDEX ... WHERE)
-- is supported identically by SQLite (3.8.0+) and PostgreSQL.
CREATE UNIQUE INDEX "Appointment_companyId_scheduledStart_active_key"
  ON "Appointment" ("companyId", "scheduledStart")
  WHERE "status" IN ('booked', 'rescheduled');
