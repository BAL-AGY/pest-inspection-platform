-- CreateTable
CREATE TABLE "CampaignExperiment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "hypothesis" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "audience" TEXT,
    "creative" TEXT,
    "offer" TEXT,
    "landingPage" TEXT,
    "cta" TEXT,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" TIMESTAMPTZ(3),
    "endDate" TIMESTAMPTZ(3),
    "sourceCaseStudyIds" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CampaignExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignExperiment_companyId_status_idx" ON "CampaignExperiment"("companyId", "status");

-- AddForeignKey
ALTER TABLE "CampaignExperiment" ADD CONSTRAINT "CampaignExperiment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
