-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- AlterTable
ALTER TABLE "seat_selections" ADD COLUMN     "passengerName" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "age" INTEGER,
ADD COLUMN     "needsAssistance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assistanceNotes" TEXT;
