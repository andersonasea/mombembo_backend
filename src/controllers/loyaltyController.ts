import type { Request, Response } from "express";
import type { AuthUser } from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getLoyaltySummary } from "../services/loyalty.js";

type AuthRequest = Pick<Request, "body" | "params" | "query"> & { user?: AuthUser };

function sendSuccess<T>(res: Response, data: T) {
  return res.status(200).json({ data });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export async function getMyLoyalty(req: AuthRequest, res: Response) {
  if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  try {
    const summary = await getLoyaltySummary(client, req.user.id);
    if (!summary) return sendError(res, 404, "USER_NOT_FOUND", "Utilisateur introuvable");
    return sendSuccess(res, summary);
  } catch (error) {
    console.error("getMyLoyalty failed", error);
    return sendError(res, 500, "FETCH_FAILED", "Impossible de charger les points fidélité");
  }
}
