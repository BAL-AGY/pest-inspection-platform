-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "creationNonce" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_creationNonce_key" ON "Lead"("creationNonce");
