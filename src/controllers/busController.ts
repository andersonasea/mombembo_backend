import type { Request, Response } from "express";
import { busSchema, updateBusSchema } from "../models/schemas.js";
import {
  assertCompanyOwnership,
  enforceCompanyIdOnCreate,
  parseAuthUser,
  requireAdminAccess,
  resolveListCompanyId,
} from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";
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

export async function getAllBus(req: Request, res: Response) {
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
  const buses = await client.bus.findMany({
    where: companyId ? { companyId } : undefined,
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return sendSuccess(res, buses);
}

export async function createBus(req: Request, res: Response) {
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
  const parsed = busSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }

  const data = enforceCompanyIdOnCreate(user, parsed.data);
  const bus = await client.bus.create({ data });
  return sendSuccess(res, bus, 201);
}

export async function deleteBus(req: Request, res: Response) {
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
  const existing = await client.bus.findUnique({ where: { id } });
  if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");
  if (!assertCompanyOwnership(user, existing.companyId, res)) return;

  await client.bus.delete({ where: { id } });
  return sendSuccess(res, { id, deleted: true });
}

export async function updateBus(req: Request, res: Response) {
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
  const parsed = updateBusSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }

  const existing = await client.bus.findUnique({ where: { id } });
  if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");
  if (!assertCompanyOwnership(user, existing.companyId, res)) return;

  const data = enforceCompanyIdOnCreate(user, parsed.data);
  const bus = await client.bus.update({
    where: { id },
    data,
  });
  return sendSuccess(res, bus);
}
