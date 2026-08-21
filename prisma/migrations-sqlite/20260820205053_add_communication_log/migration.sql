-- Archived SQLite development migration (not applied to PostgreSQL).
-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockedReason" TEXT,
    "failureReason" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "providerMessageId" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Communication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Communication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Communication_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Communication_companyId_leadId_idx" ON "Communication"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "Communication_companyId_status_idx" ON "Communication"("companyId", "status");

-- CreateIndex
CREATE INDEX "Communication_appointmentId_idx" ON "Communication"("appointmentId");
