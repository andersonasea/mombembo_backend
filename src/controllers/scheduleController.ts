import type { Request, Response } from "express"
import { Prisma, type PrismaClient } from "@prisma/client"
import { scheduleSchema, updateScheduleSchema } from "../models/schemas.js"
import { toNumberValue } from "../lib/toNumberValue.js"
import {
  assertCompanyOwnership,
  parseAuthUser,
  requireAdminAccess,
  resolveListCompanyId,
} from "../lib/auth.js"
import { getPrismaClient } from "../lib/prisma.js"
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
function isMissingTableError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

async function getScheduleCompanyId(
  client: PrismaClient,
  scheduleId: string
): Promise<string | null> {
  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    select: { route: { select: { companyId: true } } },
  });
  return schedule?.route.companyId ?? null;
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
    const user = parseAuthUser(req);
    const companyId = resolveListCompanyId(
        user,
        req.query.companyId as string | undefined
    );
    const routeId = req.query.routeId as string | undefined;
    const schedules = await client.schedule.findMany({
        where: {
            ...(routeId
                ? {
                    routeId,
                    status: "ACTIVE",
                    departureTime: { gte: new Date() },
                }
                : {}),
            ...(companyId ? { route: { companyId } } : {}),
        },
        include: {
            route: { include: { company: { select: { id: true, name: true } } } },
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
                    where: { booking: { status: "CONFIRMED" } },
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
    const user = requireAdminAccess(req, res);
    if (!user) return;

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

    const route = await client.route.findUnique({ where: { id: parsed.data.routeId } });
    if (!route) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");
    if (!assertCompanyOwnership(user, route.companyId, res)) return;

    const bus = await client.bus.findUnique({ where: { id: parsed.data.busId } });
    if (!bus) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");
    if (!assertCompanyOwnership(user, bus.companyId, res)) return;

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
    const user = requireAdminAccess(req, res);
    if (!user) return;

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

    const existing = await client.schedule.findUnique({
        where: { id },
        include: { route: { select: { companyId: true } } },
    });
    if (!existing) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
    if (!assertCompanyOwnership(user, existing.route.companyId, res)) return;

    if (parsed.data.routeId) {
        const route = await client.route.findUnique({ where: { id: parsed.data.routeId } });
        if (!route) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");
        if (!assertCompanyOwnership(user, route.companyId, res)) return;
    }
    if (parsed.data.busId) {
        const bus = await client.bus.findUnique({ where: { id: parsed.data.busId } });
        if (!bus) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");
        if (!assertCompanyOwnership(user, bus.companyId, res)) return;
    }

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
    const user = requireAdminAccess(req, res);
    if (!user) return;

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
    const companyId = await getScheduleCompanyId(client, id);
    if (!companyId) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
    if (!assertCompanyOwnership(user, companyId, res)) return;

  await client.schedule.delete({ where: { id } });
  return sendSuccess(res, { id, deleted: true });
}
