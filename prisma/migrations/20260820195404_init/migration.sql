-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "serviceZipCodes" TEXT NOT NULL,
    "supportedPests" TEXT NOT NULL,
    "businessHours" TEXT NOT NULL,
    "inspectionDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxDailyInspections" INTEGER NOT NULL DEFAULT 8,
    "scoringRules" TEXT NOT NULL,
    "mqlThreshold" INTEGER NOT NULL DEFAULT 40,
    "sqlThreshold" INTEGER NOT NULL DEFAULT 70,
    "averageContractValueCents" INTEGER,
    "estimatedCommissionPercent" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inspector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Inspector_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "isHomeowner" BOOLEAN,
    "qualificationAnswers" TEXT,
    "pestConcern" TEXT,
    "hasExistingProvider" BOOLEAN,
    "existingProviderName" TEXT,
    "switchReason" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT NOT NULL DEFAULT 'prospect',
    "status" TEXT NOT NULL DEFAULT 'new',
    "outcome" TEXT,
    "lostReason" TEXT,
    "contractValueCents" INTEGER,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "landingPage" TEXT,
    "clickId" TEXT,
    "visitorId" TEXT,
    "smsConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsConsentAt" DATETIME,
    "emailConsent" BOOLEAN NOT NULL DEFAULT false,
    "emailConsentAt" DATETIME,
    "optedOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "visitorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "landingPage" TEXT,
    "clickId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FunnelEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FunnelEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "inspectorId" TEXT,
    "scheduledStart" DATETIME NOT NULL,
    "scheduledEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "rescheduledFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "Inspector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingSpend_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Lead_companyId_status_idx" ON "Lead"("companyId", "status");

-- CreateIndex
CREATE INDEX "Lead_visitorId_idx" ON "Lead"("visitorId");

-- CreateIndex
CREATE INDEX "FunnelEvent_companyId_eventType_idx" ON "FunnelEvent"("companyId", "eventType");

-- CreateIndex
CREATE INDEX "FunnelEvent_visitorId_idx" ON "FunnelEvent"("visitorId");

-- CreateIndex
CREATE INDEX "Appointment_companyId_scheduledStart_idx" ON "Appointment"("companyId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Appointment_inspectorId_scheduledStart_idx" ON "Appointment"("inspectorId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_inspectorId_scheduledStart_key" ON "Appointment"("inspectorId", "scheduledStart");

-- CreateIndex
CREATE INDEX "MarketingSpend_companyId_source_periodStart_idx" ON "MarketingSpend"("companyId", "source", "periodStart");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_entityType_entityId_idx" ON "AuditLog"("companyId", "entityType", "entityId");
