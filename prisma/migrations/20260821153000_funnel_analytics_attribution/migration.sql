-- Production-grade funnel analytics, attribution touches, and demo isolation.
ALTER TABLE "Company" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Company" SET "isDemo" = true WHERE "slug" = 'demo-pest-control';

ALTER TABLE "Lead"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gclid" TEXT,
  ADD COLUMN "fbclid" TEXT,
  ADD COLUMN "referrer" TEXT,
  ADD COLUMN "lastSource" TEXT,
  ADD COLUMN "lastMedium" TEXT,
  ADD COLUMN "lastCampaign" TEXT,
  ADD COLUMN "lastContent" TEXT,
  ADD COLUMN "lastTerm" TEXT,
  ADD COLUMN "lastLandingPage" TEXT,
  ADD COLUMN "lastGclid" TEXT,
  ADD COLUMN "lastFbclid" TEXT,
  ADD COLUMN "lastReferrer" TEXT,
  ADD COLUMN "firstTouchAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastTouchAt" TIMESTAMPTZ(3);

ALTER TABLE "Appointment" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MarketingSpend"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "medium" TEXT,
  ADD COLUMN "content" TEXT;

UPDATE "Lead" l SET "isDemo" = c."isDemo" FROM "Company" c WHERE c."id" = l."companyId";
UPDATE "Lead" SET
  "lastSource" = "source", "lastMedium" = "medium", "lastCampaign" = "campaign",
  "lastContent" = "content", "lastTerm" = "term", "lastLandingPage" = "landingPage",
  "lastGclid" = "gclid", "lastFbclid" = "fbclid", "lastReferrer" = "referrer",
  "firstTouchAt" = "createdAt", "lastTouchAt" = "updatedAt";
UPDATE "Appointment" a SET "isDemo" = c."isDemo" FROM "Company" c WHERE c."id" = a."companyId";
UPDATE "MarketingSpend" m SET "isDemo" = c."isDemo" FROM "Company" c WHERE c."id" = m."companyId";

ALTER TABLE "FunnelEvent"
  ADD COLUMN "appointmentId" TEXT,
  ADD COLUMN "eventKey" TEXT,
  ADD COLUMN "funnelStep" TEXT,
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gclid" TEXT,
  ADD COLUMN "fbclid" TEXT,
  ADD COLUMN "referrer" TEXT;

UPDATE "FunnelEvent" e
SET "eventKey" = 'legacy:' || e."id", "isDemo" = c."isDemo"
FROM "Company" c WHERE c."id" = e."companyId";
ALTER TABLE "FunnelEvent" ALTER COLUMN "eventKey" SET NOT NULL;

-- Preserve historical funnel visibility while adopting one canonical taxonomy.
UPDATE "FunnelEvent" SET "eventType" = CASE "eventType"
  WHEN 'visit' THEN 'landing_page_view'
  WHEN 'assessment_start' THEN 'funnel_started'
  WHEN 'contact_captured' THEN 'contact_information_submitted'
  WHEN 'mql' THEN 'lead_qualified'
  WHEN 'sql' THEN 'lead_qualified'
  WHEN 'scheduler_viewed' THEN 'scheduling_viewed'
  WHEN 'appointment_booked' THEN 'inspection_booked'
  WHEN 'appointment_completed' THEN 'inspection_completed'
  ELSE "eventType"
END;

-- Outcome and revenue metrics represent current state. Preserve superseded
-- history, but only the newest row per lead remains a countable conversion.
WITH ranked AS (
  SELECT "id", "leadId", ROW_NUMBER() OVER (
    PARTITION BY "companyId", "leadId" ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "FunnelEvent"
  WHERE "leadId" IS NOT NULL AND "eventType" IN ('customer_won', 'customer_lost')
)
UPDATE "FunnelEvent" e SET
  "eventKey" = CASE WHEN ranked.position = 1 THEN 'lead:' || ranked."leadId" || ':outcome' ELSE e."eventKey" END,
  "eventType" = CASE WHEN ranked.position = 1 THEN e."eventType" ELSE 'customer_outcome_superseded' END
FROM ranked WHERE e."id" = ranked."id";

WITH ranked AS (
  SELECT "id", "leadId", ROW_NUMBER() OVER (
    PARTITION BY "companyId", "leadId" ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "FunnelEvent"
  WHERE "leadId" IS NOT NULL AND "eventType" = 'revenue_recorded'
)
UPDATE "FunnelEvent" e SET
  "eventKey" = CASE WHEN ranked.position = 1 THEN 'lead:' || ranked."leadId" || ':revenue' ELSE e."eventKey" END,
  "eventType" = CASE WHEN ranked.position = 1 THEN e."eventType" ELSE 'revenue_superseded' END
FROM ranked WHERE e."id" = ranked."id";

CREATE TABLE "VisitorAttribution" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "firstSource" TEXT,
  "firstMedium" TEXT,
  "firstCampaign" TEXT,
  "firstContent" TEXT,
  "firstTerm" TEXT,
  "firstLandingPage" TEXT,
  "firstGclid" TEXT,
  "firstFbclid" TEXT,
  "firstReferrer" TEXT,
  "firstTouchedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSource" TEXT,
  "lastMedium" TEXT,
  "lastCampaign" TEXT,
  "lastContent" TEXT,
  "lastTerm" TEXT,
  "lastLandingPage" TEXT,
  "lastGclid" TEXT,
  "lastFbclid" TEXT,
  "lastReferrer" TEXT,
  "lastTouchedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "VisitorAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FunnelEvent_companyId_eventKey_key" ON "FunnelEvent"("companyId", "eventKey");
CREATE INDEX "FunnelEvent_companyId_createdAt_idx" ON "FunnelEvent"("companyId", "createdAt");
CREATE INDEX "FunnelEvent_appointmentId_idx" ON "FunnelEvent"("appointmentId");
CREATE UNIQUE INDEX "VisitorAttribution_companyId_visitorId_key" ON "VisitorAttribution"("companyId", "visitorId");
CREATE INDEX "VisitorAttribution_companyId_lastTouchedAt_idx" ON "VisitorAttribution"("companyId", "lastTouchedAt");

ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitorAttribution" ADD CONSTRAINT "VisitorAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
