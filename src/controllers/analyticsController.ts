import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { bookingsTrendQuerySchema } from "../models/schemas.js";
import { getPrismaClient } from "../lib/prisma.js";
import { isCompanyAdmin, requireAdminAccess } from "../lib/auth.js";

type Granularity = "day" | "week" | "month";

type TrendRow = {
  bucket: Date;
  count: number;
  revenue: number;
};

function sendSuccess<T>(res: Response, data: T) {
  return res.status(200).json({ data });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatBucketLabel(d: Date, granularity: Granularity): string {
  if (granularity === "month") {
    return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (granularity === "week") {
    return `Sem. ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" })}`;
  }
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function bucketKey(d: Date, granularity: Granularity): string {
  if (granularity === "month") return d.toISOString().slice(0, 7);
  return formatDateOnly(d);
}

function addToBucket(d: Date, granularity: Granularity, amount: number): Date {
  const next = new Date(d);
  if (granularity === "day") next.setUTCDate(next.getUTCDate() + amount);
  else if (granularity === "week") next.setUTCDate(next.getUTCDate() + amount * 7);
  else next.setUTCMonth(next.getUTCMonth() + amount);
  return next;
}

function alignBucketStart(d: Date, granularity: Granularity): Date {
  const aligned = new Date(d);
  if (granularity === "week") {
    const day = aligned.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    aligned.setUTCDate(aligned.getUTCDate() + diff);
  }
  if (granularity === "month") {
    aligned.setUTCDate(1);
  }
  aligned.setUTCHours(0, 0, 0, 0);
  return aligned;
}

function fillTrendPoints(
  from: Date,
  to: Date,
  granularity: Granularity,
  rows: TrendRow[]
) {
  const map = new Map(rows.map((row) => [bucketKey(row.bucket, granularity), row]));
  const points: { date: string; label: string; count: number; revenue: number }[] = [];

  let cursor = alignBucketStart(from, granularity);
  const end = alignBucketStart(to, granularity);

  while (cursor <= end) {
    const key = bucketKey(cursor, granularity);
    const row = map.get(key);
    points.push({
      date: key,
      label: formatBucketLabel(cursor, granularity),
      count: row?.count ?? 0,
      revenue: row?.revenue ?? 0,
    });
    cursor = addToBucket(cursor, granularity, 1);
  }

  return points;
}

async function queryTrend(
  from: Date,
  toExclusive: Date,
  granularity: Granularity,
  status: "CONFIRMED" | "ALL",
  companyId?: string | null
): Promise<TrendRow[]> {
  const client = getPrismaClient();
  if (!client) return [];

  const truncExpr =
    granularity === "day"
      ? Prisma.sql`DATE(b."createdAt")`
      : granularity === "week"
        ? Prisma.sql`date_trunc('week', b."createdAt")::date`
        : Prisma.sql`date_trunc('month', b."createdAt")::date`;

  const statusFilter =
    status === "ALL" ? Prisma.empty : Prisma.sql`AND b.status = 'CONFIRMED'`;

  const companyFilter =
    companyId != null ? Prisma.sql`AND r."companyId" = ${companyId}` : Prisma.empty;

  const rows = await client.$queryRaw<{ bucket: Date; count: bigint; revenue: string | number }[]>`
    SELECT ${truncExpr} AS bucket,
           COUNT(*)::bigint AS count,
           COALESCE(SUM(b."totalPrice"), 0) AS revenue
    FROM bookings b
    INNER JOIN schedules s ON b."scheduleId" = s.id
    INNER JOIN routes r ON s."routeId" = r.id
    WHERE b."createdAt" >= ${from}
      AND b."createdAt" < ${toExclusive}
      ${statusFilter}
      ${companyFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((row) => ({
    bucket: new Date(row.bucket),
    count: Number(row.count),
    revenue: Number(row.revenue),
  }));
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function getBookingsTrend(req: Request, res: Response) {
  const user = requireAdminAccess(req, res);
  if (!user) return;

  const parsed = bookingsTrendQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Paramètres invalides");
  }

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const { granularity, status } = parsed.data;
  const toDate = parsed.data.to ? parseDateOnly(parsed.data.to) : parseDateOnly(formatDateOnly(new Date()));
  const fromDate = parsed.data.from
    ? parseDateOnly(parsed.data.from)
    : addToBucket(toDate, "day", -29);

  if (fromDate > toDate) {
    return sendError(res, 400, "VALIDATION_ERROR", "La date de début doit précéder la date de fin");
  }

  const toExclusive = addToBucket(toDate, "day", 1);
  const periodDays = Math.ceil((toExclusive.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  const previousFrom = addToBucket(fromDate, "day", -periodDays);
  const companyId = isCompanyAdmin(user) ? user.companyId : null;

  try {
    const [currentRows, previousRows] = await Promise.all([
      queryTrend(fromDate, toExclusive, granularity, status, companyId),
      queryTrend(previousFrom, fromDate, granularity, status, companyId),
    ]);

    const points = fillTrendPoints(fromDate, toDate, granularity, currentRows);
    const totalBookings = points.reduce((sum, p) => sum + p.count, 0);
    const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
    const previousBookings = previousRows.reduce((sum, row) => sum + row.count, 0);
    const previousRevenue = previousRows.reduce((sum, row) => sum + row.revenue, 0);

    return sendSuccess(res, {
      points,
      summary: {
        totalBookings,
        totalRevenue,
        previousPeriodBookings: previousBookings,
        previousPeriodRevenue: previousRevenue,
        bookingsChangePercent: percentChange(totalBookings, previousBookings),
        revenueChangePercent: percentChange(totalRevenue, previousRevenue),
      },
      meta: {
        from: formatDateOnly(fromDate),
        to: formatDateOnly(toDate),
        granularity,
        status,
      },
    });
  } catch (error) {
    console.error("getBookingsTrend failed", error);
    return sendError(res, 500, "ANALYTICS_ERROR", "Impossible de charger les tendances");
  }
}
