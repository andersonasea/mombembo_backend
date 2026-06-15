import type { Request, Response } from "express"
import { routeSchema, updateRouteSchema } from "../models/schemas.js"
import { toNumberValue } from "../lib/toNumberValue.js"
import {
  assertCompanyOwnership,
  enforceCompanyIdOnCreate,
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

export async function getAllRoutes(req: Request, res: Response) {

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
    const routes = await client.route.findMany({
        where: companyId ? { companyId } : undefined,
        include: { company: { select: { id: true, name: true } } },
        orderBy: { departure: "asc" },
    });
    return sendSuccess(res, toNumberValue(routes));
}

export async function getRouteById(req: Request, res: Response) {
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
    const route = await client.route.findUnique({
        where: { id },
        include: {
            company: { select: { id: true, name: true } },
            schedules: {
                where: { status: "ACTIVE" },
                orderBy: { departureTime: "asc" },
                include: {
                    bus: { select: { plateNumber: true, model: true, totalSeats: true } },
                },
            },
        },
    });
    if (!route) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");
    return sendSuccess(res, toNumberValue(route));
}


export async function createRoute(req: Request, res: Response) {

    const user = requireAdminAccess(req, res)
    if (!user) {
        return;
    }
    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }

    const parsed = routeSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }

    const data = enforceCompanyIdOnCreate(user, parsed.data);
    const route = await client.route.create({ data });
    return sendSuccess(res, toNumberValue(route), 201);
}

export async function updateRoutes(req: Request, res: Response) {
    const user = requireAdminAccess(req, res)
    if (!user) {
        return;
    }
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
    const parsed = updateRouteSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }

    const existing = await client.route.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");
    if (!assertCompanyOwnership(user, existing.companyId, res)) return;

    const data = enforceCompanyIdOnCreate(user, parsed.data);
    const route = await client.route.update({
        where: { id },
        data,
    });
    return sendSuccess(res, toNumberValue(route));
}

export async function deleteRoute(req: Request, res: Response) {

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
    const existing = await client.route.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");
    if (!assertCompanyOwnership(user, existing.companyId, res)) return;

    await client.route.delete({ where: { id } });
    return sendSuccess(res, { id, deleted: true });
}
