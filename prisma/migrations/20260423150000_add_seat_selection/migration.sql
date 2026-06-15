-- CreateTable
CREATE TABLE IF NOT EXISTS "seat_selections" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seat_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seat_selections_scheduleId_seatNumber_key"
ON "seat_selections"("scheduleId", "seatNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seat_selections_bookingId_idx"
ON "seat_selections"("bookingId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seat_selections_bookingId_fkey'
  ) THEN
    ALTER TABLE "seat_selections"
      ADD CONSTRAINT "seat_selections_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seat_selections_scheduleId_fkey'
  ) THEN
    ALTER TABLE "seat_selections"
      ADD CONSTRAINT "seat_selections_scheduleId_fkey"
      FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
