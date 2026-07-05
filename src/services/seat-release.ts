import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const BOOKING_PENDING_TTL_MINUTES = Number(process.env.BOOKING_PENDING_TTL_MINUTES ?? 10);

export function getPendingBookingExpiryDate() {
  return new Date(Date.now() - BOOKING_PENDING_TTL_MINUTES * 60 * 1000);
}

/** Bookings that still hold seats on a schedule. */
export function activeSeatHoldWhere(pendingExpiryDate = getPendingBookingExpiryDate()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: "CONFIRMED" },
      {
        status: "PENDING",
        createdAt: { gte: pendingExpiryDate },
        OR: [{ payment: null }, { payment: { status: "PENDING" } }],
      },
    ],
  };
}

/** Bookings whose seat selections should be removed. */
function releasableBookingWhere(pendingExpiryDate = getPendingBookingExpiryDate()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: "CANCELLED" },
      {
        status: "PENDING",
        createdAt: { lt: pendingExpiryDate },
      },
      {
        status: "PENDING",
        payment: { status: "FAILED" },
      },
    ],
  };
}

export async function releaseSeatSelectionsForBooking(client: DbClient, bookingId: string) {
  await client.seatSelection.deleteMany({ where: { bookingId } });
}

export async function releaseOrphanedSeatSelectionsForSchedule(
  client: DbClient,
  scheduleId: string,
  pendingExpiryDate = getPendingBookingExpiryDate()
) {
  await client.seatSelection.deleteMany({
    where: {
      scheduleId,
      booking: releasableBookingWhere(pendingExpiryDate),
    },
  });
}
