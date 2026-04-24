import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Request, Response } from "express";
import { busSchema, companySchema, updateBusSchema } from "../models/schemas.js";
import jwt from "jsonwebtoken";

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
export async function getAllBus(req:Request,res:Response){
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
    const buses = await client.bus.findMany({
      where: companyId ? { companyId } : undefined,
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return sendSuccess(res, buses);
}  
export async function createBus(req:Request,res:Response){
    const user=requireAdmin(req,res)
    if(!user){
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
    const parsed = busSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }
  
    const bus = await client.bus.create({ data: parsed.data });
    return sendSuccess(res, bus, 201);
}
export async function deleteBus(req:Request,res:Response){
    const user = requireAdmin(req, res);
    if (!user) return;
    const client=getPrismaClient();

    if (!client) {
      return res.status(500).json({
        error: {
          code: "CONFIG_ERROR",
          message: "DATABASE_URL is required to start the backend API.",
        },
      });
    }
    const id = String(req.params.id);
    const existing = await client.bus.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");

    await client.bus.delete({ where: { id } });
    return sendSuccess(res, { id, deleted: true });
}

export async function updateBus(req:Request,res:Response){
    const user = requireAdmin(req, res);
    if (!user) return;
    const client=getPrismaClient();

    if (!client) {
      return res.status(500).json({
        error: {
          code: "CONFIG_ERROR",
          message: "DATABASE_URL is required to start the backend API.",
        },
      });
    }

    const id = String(req.params.id);
    const parsed = updateBusSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }
  
    const existing = await client.bus.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");
  
    const bus = await client.bus.update({
      where: { id },
      data: parsed.data,
    });
    return sendSuccess(res, bus);
}