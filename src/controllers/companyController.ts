import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { companySchema, updateCompanySchema } from "../models/schemas.js";
import {
  parseAuthUser,
  requirePlatformAdmin,
  resolveListCompanyId,
} from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";
import { toNumberValue } from "../lib/toNumberValue.js";
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

  const where: Prisma.TransportCompanyWhereInput = {};
  if (companyId) where.id = companyId;
  if (req.query.isActive === "true") where.isActive = true;

  const companies = await client.transportCompany.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    include: { _count: { select: { buses: true, routes: true } } },
    orderBy: { name: "asc" },
  });
  return sendSuccess(res, companies);
}

export async function getCompanyById(req: Request, res: Response) {
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
  const company = await client.transportCompany.findUnique({
    where: { id, isActive: true },
    include: {
      routes: {
        include: { _count: { select: { schedules: true } } },
        orderBy: { departure: "asc" },
      },
    },
  });

  if (!company) {
    return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");
  }

  return sendSuccess(res, toNumberValue(company));
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
