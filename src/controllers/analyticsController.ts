import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { bookingsTrendQuerySchema, usersTrendQuerySchema } from "../models/schemas.js";
import { getPrismaClient } from "../lib/prisma.js";
import { isCompanyAdmin, requireAdminAccess, requirePlatformAdmin } from "../lib/auth.js";

type Granularity = "day" | "week" | "month";
type UserGranularity = "day" | "week" | "month" | "year";

type TrendRow = {
  bucket: Date;
  count: number;
  revenue: number;
};

type RouteRankingRow = {
  routeId: string;
  departure: string;
  destination: string;
  companyName: string;
  bookings: number;
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
  companyId?: string | null,
  routeId?: string | null
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

  const routeFilter =
    routeId != null ? Prisma.sql`AND r.id = ${routeId}` : Prisma.empty;

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
      ${routeFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((row) => ({
    bucket: new Date(row.bucket),
    count: Number(row.count),
    revenue: Number(row.revenue),
  }));
}

async function queryRouteRanking(
  from: Date,
  toExclusive: Date,
  status: "CONFIRMED" | "ALL",
  companyId?: string | null
): Promise<RouteRankingRow[]> {
  const client = getPrismaClient();
  if (!client) return [];

  const statusFilter =
    status === "ALL" ? Prisma.empty : Prisma.sql`AND b.status = 'CONFIRMED'`;

  const companyFilter =
    companyId != null ? Prisma.sql`AND r."companyId" = ${companyId}` : Prisma.empty;

  const rows = await client.$queryRaw<{
    routeId: string;
    departure: string;
    destination: string;
    companyName: string;
    bookings: bigint;
    revenue: string | number;
  }[]>`
    SELECT r.id AS "routeId",
           r.departure,
           r.destination,
           c.name AS "companyName",
           COUNT(*)::bigint AS bookings,
           COALESCE(SUM(b."totalPrice"), 0) AS revenue
    FROM bookings b
    INNER JOIN schedules s ON b."scheduleId" = s.id
    INNER JOIN routes r ON s."routeId" = r.id
    INNER JOIN transport_companies c ON r."companyId" = c.id
    WHERE b."createdAt" >= ${from}
      AND b."createdAt" < ${toExclusive}
      ${statusFilter}
      ${companyFilter}
    GROUP BY r.id, r.departure, r.destination, c.name
    ORDER BY revenue DESC
    LIMIT 10
  `;

  return rows.map((row) => ({
    routeId: row.routeId,
    departure: row.departure,
    destination: row.destination,
    companyName: row.companyName,
    bookings: Number(row.bookings),
    revenue: Number(row.revenue),
  }));
}

const GENDER_KEYS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY", "UNKNOWN"] as const;
const AGE_GROUP_KEYS = ["0-17", "18-34", "35-49", "50-64", "65+", "unknown"] as const;

type DemographicRow = { bucket: Date; segment: string; count: number };

function pivotDemographicTrend(
  from: Date,
  to: Date,
  granularity: Granularity,
  rows: DemographicRow[],
  segmentKeys: readonly string[]
) {
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = bucketKey(row.bucket, granularity);
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(row.segment, row.count);
  }

  const points: Array<{ date: string; label: string; [key: string]: string | number }> = [];
  let cursor = alignBucketStart(from, granularity);
  const end = alignBucketStart(to, granularity);

  while (cursor <= end) {
    const key = bucketKey(cursor, granularity);
    const segmentMap = map.get(key);
    const point: { date: string; label: string; [key: string]: string | number } = {
      date: key,
      label: formatBucketLabel(cursor, granularity),
    };
    for (const segment of segmentKeys) {
      point[segment] = segmentMap?.get(segment) ?? 0;
    }
    points.push(point);
    cursor = addToBucket(cursor, granularity, 1);
  }

  return points;
}

function buildSummary(rows: DemographicRow[], segmentKeys: readonly string[]) {
  const totals = new Map<string, number>();
  for (const key of segmentKeys) totals.set(key, 0);
  for (const row of rows) {
    totals.set(row.segment, (totals.get(row.segment) ?? 0) + row.count);
  }
  const total = Array.from(totals.values()).reduce((sum, n) => sum + n, 0);
  return segmentKeys
    .map((segment) => ({
      segment,
      count: totals.get(segment) ?? 0,
      percent: total > 0 ? Math.round(((totals.get(segment) ?? 0) / total) * 1000) / 10 : 0,
    }))
    .filter((item) => item.count > 0);
}

async function queryGenderTrend(
  from: Date,
  toExclusive: Date,
  granularity: Granularity,
  status: "CONFIRMED" | "ALL",
  companyId?: string | null,
  routeId?: string | null
): Promise<DemographicRow[]> {
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

  const routeFilter =
    routeId != null ? Prisma.sql`AND r.id = ${routeId}` : Prisma.empty;

  try {
    const rows = await client.$queryRaw<{ bucket: Date; gender: string; count: bigint }[]>`
      SELECT ${truncExpr} AS bucket,
             COALESCE(ss.gender::text, 'UNKNOWN') AS gender,
             COUNT(*)::bigint AS count
      FROM seat_selections ss
      INNER JOIN bookings b ON ss."bookingId" = b.id
      INNER JOIN schedules s ON b."scheduleId" = s.id
      INNER JOIN routes r ON s."routeId" = r.id
      WHERE b."createdAt" >= ${from}
        AND b."createdAt" < ${toExclusive}
        ${statusFilter}
        ${companyFilter}
        ${routeFilter}
      GROUP BY bucket, gender
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      bucket: new Date(row.bucket),
      segment: row.gender,
      count: Number(row.count),
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return [];
    }
    throw error;
  }
}

async function queryAgeTrend(
  from: Date,
  toExclusive: Date,
  granularity: Granularity,
  status: "CONFIRMED" | "ALL",
  companyId?: string | null,
  routeId?: string | null
): Promise<DemographicRow[]> {
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

  const routeFilter =
    routeId != null ? Prisma.sql`AND r.id = ${routeId}` : Prisma.empty;

  const ageGroupExpr = Prisma.sql`
    CASE
      WHEN ss.age IS NULL THEN 'unknown'
      WHEN ss.age < 18 THEN '0-17'
      WHEN ss.age < 35 THEN '18-34'
      WHEN ss.age < 50 THEN '35-49'
      WHEN ss.age < 65 THEN '50-64'
      ELSE '65+'
    END
  `;

  try {
    const rows = await client.$queryRaw<{ bucket: Date; age_group: string; count: bigint }[]>`
      SELECT ${truncExpr} AS bucket,
             ${ageGroupExpr} AS age_group,
             COUNT(*)::bigint AS count
      FROM seat_selections ss
      INNER JOIN bookings b ON ss."bookingId" = b.id
      INNER JOIN schedules s ON b."scheduleId" = s.id
      INNER JOIN routes r ON s."routeId" = r.id
      WHERE b."createdAt" >= ${from}
        AND b."createdAt" < ${toExclusive}
        ${statusFilter}
        ${companyFilter}
        ${routeFilter}
      GROUP BY bucket, age_group
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      bucket: new Date(row.bucket),
      segment: row.age_group,
      count: Number(row.count),
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return [];
    }
    throw error;
  }
}

export async function getPassengerDemographics(req: Request, res: Response) {
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

  const { granularity, status, routeId } = parsed.data;
  const toDate = parsed.data.to ? parseDateOnly(parsed.data.to) : parseDateOnly(formatDateOnly(new Date()));
  const fromDate = parsed.data.from
    ? parseDateOnly(parsed.data.from)
    : addToBucket(toDate, "day", -29);

  if (fromDate > toDate) {
    return sendError(res, 400, "VALIDATION_ERROR", "La date de début doit précéder la date de fin");
  }

  const toExclusive = addToBucket(toDate, "day", 1);
  const companyId = isCompanyAdmin(user) ? user.companyId : null;

  if (routeId) {
    const route = await client.route.findUnique({
      where: { id: routeId },
      select: { id: true, companyId: true },
    });
    if (!route) {
      return sendError(res, 404, "ROUTE_NOT_FOUND", "Ligne introuvable");
    }
    if (companyId != null && route.companyId !== companyId) {
      return sendError(res, 403, "FORBIDDEN", "Accès non autorisé pour cette ligne");
    }
  }

  try {
    const [genderRows, ageRows] = await Promise.all([
      queryGenderTrend(fromDate, toExclusive, granularity, status, companyId, routeId ?? null),
      queryAgeTrend(fromDate, toExclusive, granularity, status, companyId, routeId ?? null),
    ]);

    const totalPassengers =
      genderRows.reduce((sum, row) => sum + row.count, 0) ||
      ageRows.reduce((sum, row) => sum + row.count, 0);

    return sendSuccess(res, {
      genderTrend: pivotDemographicTrend(fromDate, toDate, granularity, genderRows, GENDER_KEYS),
      ageTrend: pivotDemographicTrend(fromDate, toDate, granularity, ageRows, AGE_GROUP_KEYS),
      genderSummary: buildSummary(genderRows, GENDER_KEYS),
      ageSummary: buildSummary(ageRows, AGE_GROUP_KEYS),
      summary: { totalPassengers },
      meta: {
        from: formatDateOnly(fromDate),
        to: formatDateOnly(toDate),
        granularity,
        status,
        routeId: routeId ?? null,
      },
    });
  } catch (error) {
    console.error("getPassengerDemographics failed", error);
    return sendError(res, 500, "ANALYTICS_ERROR", "Impossible de charger les tendances passagers");
  }
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

  const { granularity, status, routeId } = parsed.data;
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

  if (routeId) {
    const route = await client.route.findUnique({
      where: { id: routeId },
      select: { id: true, companyId: true, departure: true, destination: true },
    });
    if (!route) {
      return sendError(res, 404, "ROUTE_NOT_FOUND", "Ligne introuvable");
    }
    if (companyId != null && route.companyId !== companyId) {
      return sendError(res, 403, "FORBIDDEN", "Accès non autorisé pour cette ligne");
    }
  }

  try {
    const [currentRows, previousRows, routeRanking] = await Promise.all([
      queryTrend(fromDate, toExclusive, granularity, status, companyId, routeId ?? null),
      queryTrend(previousFrom, fromDate, granularity, status, companyId, routeId ?? null),
      queryRouteRanking(fromDate, toExclusive, status, companyId),
    ]);

    const points = fillTrendPoints(fromDate, toDate, granularity, currentRows);
    const totalBookings = points.reduce((sum, p) => sum + p.count, 0);
    const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
    const previousBookings = previousRows.reduce((sum, row) => sum + row.count, 0);
    const previousRevenue = previousRows.reduce((sum, row) => sum + row.revenue, 0);

    return sendSuccess(res, {
      points,
      routeRanking,
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
        routeId: routeId ?? null,
      },
    });
  } catch (error) {
    console.error("getBookingsTrend failed", error);
    return sendError(res, 500, "ANALYTICS_ERROR", "Impossible de charger les tendances");
  }
}

export async function getDashboardStats(req: Request, res: Response) {
  const user = requireAdminAccess(req, res);
  if (!user) return;

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const companyId = isCompanyAdmin(user) ? user.companyId : null;
  const companyFilter = companyId ? { companyId } : undefined;
  const bookingFilter = companyId
    ? { status: "CONFIRMED" as const, schedule: { route: { companyId } } }
    : { status: "CONFIRMED" as const };

  const [companies, buses, routes, users, bookings] = await Promise.all([
    companyId
      ? client.transportCompany.count({ where: { id: companyId } })
      : client.transportCompany.count(),
    client.bus.count({ where: companyFilter }),
    client.route.count({ where: companyFilter }),
    companyId ? Promise.resolve(0) : client.user.count({ where: { role: "CLIENT" } }),
    client.booking.count({ where: bookingFilter }),
  ]);

  return sendSuccess(res, { companies, buses, routes, users, bookings });
}

function alignUserBucketStart(d: Date, granularity: UserGranularity): Date {
  const aligned = alignBucketStart(d, granularity === "year" ? "month" : granularity);
  if (granularity === "year") {
    aligned.setUTCMonth(0, 1);
  }
  return aligned;
}

function addToUserBucket(d: Date, granularity: UserGranularity, amount: number): Date {
  const next = new Date(d);
  if (granularity === "year") {
    next.setUTCFullYear(next.getUTCFullYear() + amount);
    return next;
  }
  return addToBucket(d, granularity, amount);
}

function userBucketKey(d: Date, granularity: UserGranularity): string {
  if (granularity === "year") return String(d.getUTCFullYear());
  return bucketKey(d, granularity);
}

function formatUserBucketLabel(d: Date, granularity: UserGranularity): string {
  if (granularity === "year") {
    return d.toLocaleDateString("fr-FR", { year: "numeric", timeZone: "UTC" });
  }
  return formatBucketLabel(d, granularity);
}

function fillUserTrendPoints(
  from: Date,
  to: Date,
  granularity: UserGranularity,
  rows: { bucket: Date; count: number }[]
) {
  const map = new Map(rows.map((row) => [userBucketKey(row.bucket, granularity), row]));
  const points: { date: string; label: string; count: number; cumulative: number }[] = [];
  let cursor = alignUserBucketStart(from, granularity);
  const end = alignUserBucketStart(to, granularity);
  let cumulative = 0;

  while (cursor <= end) {
    const key = userBucketKey(cursor, granularity);
    const row = map.get(key);
    const count = row?.count ?? 0;
    cumulative += count;
    points.push({
      date: key,
      label: formatUserBucketLabel(cursor, granularity),
      count,
      cumulative,
    });
    cursor = addToUserBucket(cursor, granularity, 1);
  }

  return points;
}

async function queryUserRegistrations(
  from: Date,
  toExclusive: Date,
  granularity: UserGranularity
): Promise<{ bucket: Date; count: number }[]> {
  const client = getPrismaClient();
  if (!client) return [];

  const truncExpr =
    granularity === "day"
      ? Prisma.sql`DATE(u."createdAt")`
      : granularity === "week"
        ? Prisma.sql`date_trunc('week', u."createdAt")::date`
        : granularity === "month"
          ? Prisma.sql`date_trunc('month', u."createdAt")::date`
          : Prisma.sql`date_trunc('year', u."createdAt")::date`;

  const rows = await client.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT ${truncExpr} AS bucket,
           COUNT(*)::bigint AS count
    FROM users u
    WHERE u."createdAt" >= ${from}
      AND u."createdAt" < ${toExclusive}
      AND u.role = 'CLIENT'
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((row) => ({
    bucket: new Date(row.bucket),
    count: Number(row.count),
  }));
}

export async function getUsersTrend(req: Request, res: Response) {
  const admin = requirePlatformAdmin(req, res);
  if (!admin) return;

  const parsed = usersTrendQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Paramètres invalides");
  }

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const { granularity } = parsed.data;
  const toDate = parsed.data.to ? parseDateOnly(parsed.data.to) : parseDateOnly(formatDateOnly(new Date()));
  const fromDate = parsed.data.from
    ? parseDateOnly(parsed.data.from)
    : granularity === "year"
      ? addToUserBucket(toDate, "year", -4)
      : granularity === "month"
        ? addToBucket(toDate, "month", -11)
        : granularity === "week"
          ? addToBucket(toDate, "week", -11)
          : addToBucket(toDate, "day", -29);

  if (fromDate > toDate) {
    return sendError(res, 400, "VALIDATION_ERROR", "La date de début doit précéder la date de fin");
  }

  const toExclusive = addToBucket(toDate, "day", 1);
  const periodMs = toExclusive.getTime() - fromDate.getTime();
  const previousFrom = new Date(fromDate.getTime() - periodMs);

  try {
    const [currentRows, previousRows] = await Promise.all([
      queryUserRegistrations(fromDate, toExclusive, granularity),
      queryUserRegistrations(previousFrom, fromDate, granularity),
    ]);

    const points = fillUserTrendPoints(fromDate, toDate, granularity, currentRows);
    const totalRegistrations = points.reduce((sum, point) => sum + point.count, 0);
    const previousRegistrations = previousRows.reduce((sum, row) => sum + row.count, 0);

    return sendSuccess(res, {
      points,
      summary: {
        totalRegistrations,
        previousPeriodRegistrations: previousRegistrations,
        changePercent: percentChange(totalRegistrations, previousRegistrations),
      },
      meta: {
        from: formatDateOnly(fromDate),
        to: formatDateOnly(toDate),
        granularity,
      },
    });
  } catch (error) {
    console.error("getUsersTrend failed", error);
    return sendError(res, 500, "ANALYTICS_ERROR", "Impossible de charger les tendances d'inscription");
  }
}
