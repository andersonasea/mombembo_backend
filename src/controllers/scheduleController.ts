import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import type { Request, Response } from "express"
import jwt from "jsonwebtoken"
import { Prisma } from "@prisma/client"
import { scheduleSchema, updateScheduleSchema } from "../models/schemas.js"

let prisma: PrismaClient | null = null;
function getPrismaClient(): PrismaClient | null {
    if (!process.env.DATABASE_URL) {
        return null;
    }
    if (!prisma) {
        prisma = new PrismaClient({
            adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
        });
    }
    return prisma;
}
function sendSuccess<T>(
    res: Response,
    data: T,
    status = 200,
    meta?: Record<string, unknown>
) {
    return res.status(status).json({
        data,
        ...(meta ? { meta } : {}),
    });
}

function sendError(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown
) {
    return res.status(status).json({
        error: {
            code,
            message,
            ...(details ? { details } : {}),
        },
    });
}
function toNumberValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => toNumberValue(item)) as T;
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        Object.entries(obj).forEach(([key, item]) => {
            if (item && typeof item === "object" && "toNumber" in (item as object)) {
                out[key] = Number(item);
            } else {
                out[key] = toNumberValue(item);
            }
        });
        return out as T;
    }
    return value;
}
function isMissingTableError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

type AuthUser = { id: string; role: "ADMIN" | "CLIENT" };

function requireAdmin(req: Request, res: Response) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendError(res, 401, "UNAUTHORIZED", "Token manquant");
        return null;
    }
    const token = authHeader.slice(7);
    const jwtSecret = process.env.JWT_SECRET ?? "change-me";
    try {
        const payload = jwt.verify(token, jwtSecret) as AuthUser;
        if (payload.role !== "ADMIN") {
            sendError(res, 403, "FORBIDDEN", "Accès administrateur requis");
            return null;
        }
        return payload;
    } catch {
        sendError(res, 401, "UNAUTHORIZED", "Token invalide");
        return null;
    }
}

export async function getAllSchedules(req: Request, res: Response) {
    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    const routeId = req.query.routeId as string | undefined;
    const schedules = await client.schedule.findMany({
        where: routeId
            ? {
                routeId,
                status: "ACTIVE",
                departureTime: { gte: new Date() },
                availableSeats: { gt: 0 },
            }
            : undefined,
        include: {
            route: { include: { company: { select: { name: true } } } },
            bus: { select: { id: true, plateNumber: true, model: true, totalSeats: true } },
        },
        orderBy: { departureTime: "asc" },
    });
    return sendSuccess(res, toNumberValue(schedules));
}

export async function getAllSchedulesbyId(req: Request, res: Response) {
    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    const id = String(req.params.id);
    let schedule;
    try {
        schedule = await client.schedule.findUnique({
            where: { id },
            include: {
                route: { include: { company: { select: { id: true, name: true } } } },
                bus: { select: { plateNumber: true, model: true, totalSeats: true } },
                seatSelections: {
                    where: { booking: { status: { not: "CANCELLED" } } },
                    select: { seatNumber: true },
                },
            } as Prisma.ScheduleInclude,
        });
    } catch (error) {
        if (!isMissingTableError(error)) throw error;
        schedule = await client.schedule.findUnique({
            where: { id },
            include: {
                route: { include: { company: { select: { id: true, name: true } } } },
                bus: { select: { plateNumber: true, model: true, totalSeats: true } },
            },
        });
    }
    if (!schedule) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
    return sendSuccess(res, toNumberValue(schedule));
}

export async function createSchedule(req: Request, res: Response) {

    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }

    const bus = await client.bus.findUnique({ where: { id: parsed.data.busId } });
    if (!bus) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");

    const schedule = await client.schedule.create({
        data: {
            routeId: parsed.data.routeId,
            busId: parsed.data.busId,
            departureTime: new Date(parsed.data.departureTime),
            arrivalTime: parsed.data.arrivalTime ? new Date(parsed.data.arrivalTime) : null,
            availableSeats: bus.totalSeats,
        },
    });
    return sendSuccess(res, schedule, 201);
}

export async function updateSchedul(req: Request, res: Response) {

    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    const id = String(req.params.id);
    const parsed = updateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }

    const existing = await client.schedule.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");

    const data = {
        ...(parsed.data.routeId ? { routeId: parsed.data.routeId } : {}),
        ...(parsed.data.busId ? { busId: parsed.data.busId } : {}),
        ...(parsed.data.departureTime ? { departureTime: new Date(parsed.data.departureTime) } : {}),
        ...(parsed.data.arrivalTime !== undefined
            ? { arrivalTime: parsed.data.arrivalTime ? new Date(parsed.data.arrivalTime) : null }
            : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
    };

    const schedule = await client.schedule.update({
        where: { id },
        data,
    });
    return sendSuccess(res, schedule);
}

export async function deleteSchedule(req:Request,res:Response){
    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    const id = String(req.params.id);
  const existing = await client.schedule.findUnique({ where: { id } });
  if (!existing) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");

  await client.schedule.delete({ where: { id } });
  return sendSuccess(res, { id, deleted: true });
}