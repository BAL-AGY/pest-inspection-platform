-- Provider-neutral outbound/inbound communication lifecycle and idempotency.
ALTER TABLE "Lead"
  ADD COLUMN "normalizedEmail" TEXT,
  ADD COLUMN "normalizedPhone" TEXT,
  ADD COLUMN "smsConsentSource" TEXT,
  ADD COLUMN "smsMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smsMarketingConsentAt" TIMESTAMPTZ(3),
  ADD COLUMN "smsMarketingConsentSource" TEXT,
  ADD COLUMN "smsOptedOutAt" TIMESTAMPTZ(3),
  ADD COLUMN "emailConsentSource" TEXT,
  ADD COLUMN "emailMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailMarketingConsentAt" TIMESTAMPTZ(3),
  ADD COLUMN "emailMarketingConsentSource" TEXT,
  ADD COLUMN "emailOptedOutAt" TIMESTAMPTZ(3);

UPDATE "Lead" SET "normalizedEmail" = lower(trim("email")) WHERE "email" IS NOT NULL;
UPDATE "Lead" SET "normalizedPhone" = regexp_replace("phone", '[^0-9]', '', 'g') WHERE "phone" IS NOT NULL;
UPDATE "Lead" SET "normalizedPhone" = substring("normalizedPhone" from 2)
WHERE length("normalizedPhone") = 11 AND "normalizedPhone" LIKE '1%';

CREATE INDEX "Lead_companyId_normalizedEmail_idx" ON "Lead"("companyId", "normalizedEmail");
CREATE INDEX "Lead_companyId_normalizedPhone_idx" ON "Lead"("companyId", "normalizedPhone");

ALTER TABLE "SuppressionEntry" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'all';

CREATE TABLE "CommunicationProviderAccount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "address" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationProviderAccount_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Communication"
  ADD COLUMN "providerAccountId" TEXT,
  ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'outbound',
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'transactional',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'development',
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "from" TEXT,
  ADD COLUMN "body" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "failedAt" TIMESTAMPTZ(3),
  ADD COLUMN "bouncedAt" TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerStatusAt" TIMESTAMPTZ(3);

UPDATE "Communication"
SET "dedupeKey" = 'legacy:' || "id",
    "status" = CASE WHEN "status" = 'sent' THEN 'accepted' ELSE "status" END,
    "acceptedAt" = CASE WHEN "status" = 'sent' THEN "attemptedAt" ELSE NULL END;
ALTER TABLE "Communication" ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE TABLE "CommunicationWebhookEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "communicationId" TEXT,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  CONSTRAINT "CommunicationWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationProviderAccount_provider_externalAccountId_key" ON "CommunicationProviderAccount"("provider", "externalAccountId");
CREATE INDEX "CommunicationProviderAccount_companyId_channel_idx" ON "CommunicationProviderAccount"("companyId", "channel");
CREATE UNIQUE INDEX "Communication_companyId_dedupeKey_key" ON "Communication"("companyId", "dedupeKey");
CREATE UNIQUE INDEX "Communication_companyId_provider_providerMessageId_key" ON "Communication"("companyId", "provider", "providerMessageId");
CREATE INDEX "CommunicationWebhookEvent_companyId_receivedAt_idx" ON "CommunicationWebhookEvent"("companyId", "receivedAt");
CREATE INDEX "CommunicationWebhookEvent_communicationId_idx" ON "CommunicationWebhookEvent"("communicationId");
CREATE UNIQUE INDEX "CommunicationWebhookEvent_provider_providerEventId_key" ON "CommunicationWebhookEvent"("provider", "providerEventId");

ALTER TABLE "CommunicationProviderAccount" ADD CONSTRAINT "CommunicationProviderAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "CommunicationProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationWebhookEvent" ADD CONSTRAINT "CommunicationWebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationWebhookEvent" ADD CONSTRAINT "CommunicationWebhookEvent_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "CommunicationProviderAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationWebhookEvent" ADD CONSTRAINT "CommunicationWebhookEvent_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "Communication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
