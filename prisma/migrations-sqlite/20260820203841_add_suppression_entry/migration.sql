-- Archived SQLite development migration (not applied to PostgreSQL).
-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "identifierValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuppressionEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SuppressionEntry_companyId_identifierType_identifierValue_idx" ON "SuppressionEntry"("companyId", "identifierType", "identifierValue");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_companyId_channel_identifierType_identifierValue_key" ON "SuppressionEntry"("companyId", "channel", "identifierType", "identifierValue");
