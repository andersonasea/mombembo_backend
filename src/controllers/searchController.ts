import type { Request, Response } from "express";
import { tripSearchQuerySchema } from "../models/schemas.js";
import { toNumberValue } from "../lib/toNumberValue.js";
import { getPrismaClient } from "../lib/prisma.js";

function sendSuccess<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ data, ...(meta ? { meta } : {}) });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function parseDayBounds(
  dateStr: string,
  timeFrom?: string,
  timeTo?: string
): { gte: Date; lte: Date } {
  const [year, month, day] = dateStr.split("-").map(Number);
  let gte = new Date(year, month - 1, day, 0, 0, 0, 0);
  let lte = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (timeFrom) {
    const [hours, minutes] = timeFrom.split(":").map(Number);
    gte = new Date(year, month - 1, day, hours, minutes, 0, 0);
  }
  if (timeTo) {
    const [hours, minutes] = timeTo.split(":").map(Number);
    lte = new Date(year, month - 1, day, hours, minutes, 59, 999);
  }

  const now = new Date();
  if (gte < now) gte = now;

  return { gte, lte };
}

export async function searchTrips(req: Request, res: Response) {
  const parsed = tripSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Paramètres de recherche invalides"
    );
  }

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const { departure, destination, date, maxPrice, timeFrom, timeTo, minSeats } = parsed.data;
  const { gte, lte } = parseDayBounds(date, timeFrom, timeTo);

  if (gte > lte) {
    return sendSuccess(res, [], {
      count: 0,
      filters: { departure, destination, date, maxPrice, timeFrom, timeTo, minSeats },
    });
  }

  const trips = await client.schedule.findMany({
    where: {
      status: "ACTIVE",
      availableSeats: { gte: minSeats },
      departureTime: { gte, lte },
      route: {
        price: { lte: maxPrice },
        departure: { contains: departure, mode: "insensitive" },
        destination: { contains: destination, mode: "insensitive" },
        company: { isActive: true },
      },
    },
    include: {
      route: {
        include: {
          company: { select: { id: true, name: true } },
        },
      },
      bus: { select: { plateNumber: true, model: true, totalSeats: true } },
    },
    orderBy: [{ departureTime: "asc" }, { route: { price: "asc" } }],
  });

  return sendSuccess(res, toNumberValue(trips), {
    count: trips.length,
    filters: { departure, destination, date, maxPrice, timeFrom, timeTo, minSeats },
  });
}
