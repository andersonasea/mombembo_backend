-- CreateEnum
CREATE TYPE "PrelaunchLeadSource" AS ENUM (
  'GENERAL',
  'PARTNER',
  'PILOT_KINSHASA_KIKWIT'
);

-- CreateTable
CREATE TABLE "prelaunch_leads" (
  "id" TEXT NOT NULL,
  "source" "PrelaunchLeadSource" NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "companyName" TEXT,
  "preferredRoute" TEXT,
  "message" TEXT,
  "consent" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "prelaunch_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prelaunch_leads_source_phone_key"
ON "prelaunch_leads"("source", "phone");

-- CreateIndex
CREATE INDEX "prelaunch_leads_source_createdAt_idx"
ON "prelaunch_leads"("source", "createdAt");
