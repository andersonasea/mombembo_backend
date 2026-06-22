import type { LoyaltyTier, Prisma } from "@prisma/client";

export const LOYALTY_TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  BRONZE: 0,
  SILVER: 500,
  GOLD: 2000,
};

export const LOYALTY_TIER_BONUSES: Partial<Record<LoyaltyTier, number>> = {
  SILVER: 100,
  GOLD: 250,
};

export const LOYALTY_REWARDS = [
  { id: "discount-5", label: "5 % de réduction", cost: 200 },
  { id: "discount-10", label: "10 % de réduction", cost: 450 },
  { id: "free-seat", label: "1 place offerte (trajet standard)", cost: 800 },
] as const;

const TIER_ORDER: LoyaltyTier[] = ["BRONZE", "SILVER", "GOLD"];

export function computeEarnedPoints(totalPriceCdf: number, seatsBooked: number) {
  const base = 50;
  const spend = Math.floor(totalPriceCdf / 1000);
  const multiSeat = seatsBooked > 1 ? 10 : 0;
  return base + spend + multiSeat;
}

export function resolveTier(points: number): LoyaltyTier {
  if (points >= LOYALTY_TIER_THRESHOLDS.GOLD) return "GOLD";
  if (points >= LOYALTY_TIER_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
}

export function getNextTier(current: LoyaltyTier): LoyaltyTier | null {
  const index = TIER_ORDER.indexOf(current);
  return index < TIER_ORDER.length - 1 ? TIER_ORDER[index + 1]! : null;
}

export function buildCalculator(points: number, confirmedTrips: number) {
  const tier = resolveTier(points);
  const nextTier = getNextTier(tier);
  const pointsPerTripEstimate = computeEarnedPoints(15_000, 1);
  const remaining = nextTier
    ? Math.max(0, LOYALTY_TIER_THRESHOLDS[nextTier] - points)
    : 0;
  const tripsToNextTier =
    nextTier && pointsPerTripEstimate > 0
      ? Math.ceil(remaining / pointsPerTripEstimate)
      : 0;

  return {
    pointsPerTripEstimate,
    tripsToNextTier,
    confirmedTrips,
    rewards: LOYALTY_REWARDS.map((reward) => ({
      ...reward,
      affordable: points >= reward.cost,
      remaining: Math.max(0, reward.cost - points),
    })),
  };
}

type TxClient = Prisma.TransactionClient;

export async function awardLoyaltyForBooking(tx: TxClient, bookingId: string) {
  const existing = await tx.loyaltyTransaction.findUnique({
    where: { bookingId },
    select: { id: true },
  });
  if (existing) return;

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      seatsBooked: true,
      totalPrice: true,
      schedule: {
        select: {
          route: { select: { departure: true, destination: true } },
        },
      },
    },
  });
  if (!booking) return;

  const earned = computeEarnedPoints(Number(booking.totalPrice), booking.seatsBooked);
  const routeLabel = `${booking.schedule.route.departure} → ${booking.schedule.route.destination}`;

  const user = await tx.user.findUnique({
    where: { id: booking.userId },
    select: { loyaltyPoints: true, loyaltyTier: true },
  });
  if (!user) return;

  let balance = user.loyaltyPoints + earned;

  await tx.loyaltyTransaction.create({
    data: {
      userId: booking.userId,
      bookingId: booking.id,
      type: "EARN",
      points: earned,
      balanceAfter: balance,
      description: `Voyage ${routeLabel}`,
    },
  });

  const newTier = resolveTier(balance);
  if (newTier !== user.loyaltyTier) {
    const bonus = LOYALTY_TIER_BONUSES[newTier] ?? 0;
    if (bonus > 0) {
      balance += bonus;
      await tx.loyaltyTransaction.create({
        data: {
          userId: booking.userId,
          type: "BONUS",
          points: bonus,
          balanceAfter: balance,
          description: `Bonus palier ${newTier}`,
        },
      });
    }
  }

  await tx.user.update({
    where: { id: booking.userId },
    data: { loyaltyPoints: balance, loyaltyTier: newTier },
  });
}

export async function getLoyaltySummary(
  client: { user: TxClient["user"]; booking: TxClient["booking"]; loyaltyTransaction: TxClient["loyaltyTransaction"] },
  userId: string
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { loyaltyPoints: true, loyaltyTier: true },
  });
  if (!user) return null;

  const [stats, transactions] = await Promise.all([
    client.booking.aggregate({
      where: { userId, status: "CONFIRMED" },
      _count: { id: true },
      _sum: { totalPrice: true },
    }),
    client.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        points: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
      },
    }),
  ]);

  const points = user.loyaltyPoints;
  const tier = user.loyaltyTier;
  const nextTier = getNextTier(tier);
  const confirmedTrips = stats._count.id;
  const totalSpentCdf = Number(stats._sum.totalPrice ?? 0);

  return {
    points,
    tier,
    nextTier: nextTier
      ? {
          name: nextTier,
          at: LOYALTY_TIER_THRESHOLDS[nextTier],
          remaining: Math.max(0, LOYALTY_TIER_THRESHOLDS[nextTier] - points),
        }
      : null,
    stats: { confirmedTrips, totalSpentCdf },
    calculator: buildCalculator(points, confirmedTrips),
    transactions,
  };
}
