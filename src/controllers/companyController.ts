import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { companySchema,updateCompanySchema } from "../models/schemas.js";

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


export async function getAllCompanies(req: Request, res: Response) {
  const client = getPrismaClient();
  if (!client) {
    return res.status(500).json({
      error: {
        code: "CONFIG_ERROR",
        message: "DATABASE_URL is required to start the backend API.",
      },
    });
  }

  const companies = await client.transportCompany.findMany({
    include: { _count: { select: { buses: true, routes: true } } },
    orderBy: { name: "asc" },
  });
  return sendSuccess(res, companies);
}

export async function createCompany(req: Request, res: Response) {
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
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }

  const company = await client.transportCompany.create({ data: parsed.data });
  return sendSuccess(res, company, 201);
  
}

export async function deleteCompany(req:Request,res:Response){
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
    const existing = await client.transportCompany.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");
  
    await client.transportCompany.delete({ where: { id } });
    return sendSuccess(res, { id, deleted: true });

}

export async function updateCompany(req:Request,res:Response){
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
    const parsed = updateCompanySchema.safeParse(req.body);
 
    const id = String(req.params.id);
   
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }
  
    const existing = await client.transportCompany.findUnique({ where: { id } });
    if (!existing) return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");
  
    const company = await client.transportCompany.update({
      where: { id },
      data: parsed.data,
    });
    return sendSuccess(res, company);

}
