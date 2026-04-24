import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import type { Request, Response } from "express"
import jwt from "jsonwebtoken"
import { routeSchema, updateRouteSchema } from "../models/schemas.js"

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
    const companyId = req.query.companyId as string | undefined;
    const routes = await client.route.findMany({
        where: companyId ? { companyId } : undefined,
        include: { company: { select: { name: true } } },
        orderBy: { departure: "asc" },
    });
    return sendSuccess(res, toNumberValue(routes));
}


export async function createRoute(req: Request, res: Response) {

    const user = requireAdmin(req, res)
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

    const route = await client.route.create({ data: parsed.data });
    return sendSuccess(res, toNumberValue(route), 201);
}

export async function updateRoutes(req: Request, res: Response) {
    const user = requireAdmin(req, res)
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

    const route = await client.route.update({
        where: { id },
        data: parsed.data,
    });
    return sendSuccess(res, toNumberValue(route));
}

export async function deleteRoute(req: Request, res: Response) {

    const user = requireAdmin(req, res);
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

    await client.route.delete({ where: { id } });
    return sendSuccess(res, { id, deleted: true });
}