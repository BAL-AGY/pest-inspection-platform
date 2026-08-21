-- Additive, nullable fields preserve every existing company and lead. Existing
-- detailed pest concerns are categorized for reporting without changing their
-- original qualification answers.
ALTER TABLE "Company"
  ADD COLUMN "pestCategoryConfig" TEXT,
  ADD COLUMN "serviceArrangements" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN "pestCategory" TEXT,
  ADD COLUMN "actualPestCategory" TEXT,
  ADD COLUMN "serviceArrangement" TEXT;

UPDATE "Lead"
SET "pestCategory" = CASE
  WHEN "pestConcern" IN ('general_pest', 'ants', 'roaches', 'spiders', 'wasps') THEN 'general_pest'
  WHEN "pestConcern" = 'fleas' THEN 'fleas'
  WHEN "pestConcern" = 'rodents' THEN 'rodents'
  WHEN "pestConcern" IS NOT NULL THEN 'other'
  ELSE NULL
END;

CREATE INDEX "Lead_companyId_pestCategory_idx" ON "Lead"("companyId", "pestCategory");
