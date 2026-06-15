import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Request, Response } from "express";
import { companySchema, updateCompanySchema } from "../models/schemas.js";
import {
  parseAuthUser,
  requirePlatformAdmin,
  resolveListCompanyId,
} from "../lib/auth.js";

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

  const user = parseAuthUser(req);
  const companyId = resolveListCompanyId(
    user,
    req.query.companyId as string | undefined
  );

  const companies = await client.transportCompany.findMany({
    where: companyId ? { id: companyId } : undefined,
    include: { _count: { select: { buses: true, routes: true } } },
    orderBy: { name: "asc" },
  });
  return sendSuccess(res, companies);
}

export async function createCompany(req: Request, res: Response) {
  const user = requirePlatformAdmin(req, res);
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

export async function deleteCompany(req: Request, res: Response) {
  const user = requirePlatformAdmin(req, res);
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
  const existing = await client.transportCompany.findUnique({ where: { id } });
  if (!existing) return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");

  await client.transportCompany.delete({ where: { id } });
  return sendSuccess(res, { id, deleted: true });
}

export async function updateCompany(req: Request, res: Response) {
  const user = requirePlatformAdmin(req, res);
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
