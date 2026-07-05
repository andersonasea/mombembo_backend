import type { PrismaClient } from "@prisma/client";
import { checkFlexpayPaymentStatus } from "./flexpay.js";
import { awardLoyaltyForBooking } from "./loyalty.js";
import { releaseSeatSelectionsForBooking } from "./seat-release.js";
export async function finalizeSuccessfulPayment(
  client: PrismaClient,
  paymentId: string,
  bookingId: string
) {
  await client.$transaction(async (tx) => {
    const freshBooking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, scheduleId: true, seatsBooked: true },
    });
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "SUCCESS", paidAt: new Date() },
    });
    if (freshBooking && freshBooking.status !== "CONFIRMED") {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: "CONFIRMED" },
      });
      await tx.schedule.update({
        where: { id: freshBooking.scheduleId },
        data: { availableSeats: { decrement: freshBooking.seatsBooked } },
      });
      await awardLoyaltyForBooking(tx, bookingId);
    }
  });
}

export async function syncPaymentWithProvider(
  client: PrismaClient,
  bookingId: string
): Promise<boolean> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking?.payment) return false;

  const payment = booking.payment;
  if (payment.status === "SUCCESS" && booking.status === "PENDING") {
    await finalizeSuccessfulPayment(client, payment.id, booking.id);
    return true;
  }
  if (payment.status === "FAILED") {
    await releaseSeatSelectionsForBooking(client, booking.id);
    return false;
  }
  if (payment.status !== "PENDING" || !payment.transactionRef) {
    return payment.status === "SUCCESS" && booking.status === "CONFIRMED";
  }

  const providerStatus = await checkFlexpayPaymentStatus(payment.transactionRef);
  if (providerStatus.status === "SUCCESS") {
    await finalizeSuccessfulPayment(client, payment.id, booking.id);
    return true;
  }
  if (providerStatus.status === "FAILED") {
    await client.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      await releaseSeatSelectionsForBooking(tx, booking.id);
    });
  }
  return false;
}
