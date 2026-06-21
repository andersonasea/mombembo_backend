import type { Request, Response } from "express";
import { updateProfileSchema } from "../models/schemas.js";
import type { AuthUser } from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";

type AuthRequest = Pick<Request, "body" | "params" | "query"> & { user?: AuthUser };
function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  return res.status(status).json({ error: { code, message } });
}

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  imageUrl?: string | null;
  role: string;
  companyId?: string | null;
  company?: { id: string; name: string } | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    imageUrl: user.imageUrl ?? null,
    role: user.role,
    companyId: user.companyId ?? null,
    companyName: user.company?.name ?? null,
  };
}

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  imageUrl: true,
  role: true,
  companyId: true,
  company: { select: { id: true, name: true } },
} as const;

export async function getCurrentUser(req: AuthRequest, res: Response) {
  if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const includeImageRaw = req.query?.includeImage;
  const includeImage = includeImageRaw === "1" || includeImageRaw === "true";

  try {
    const user = await client.user.findUnique({
      where: { id: req.user.id },
      select: userProfileSelect,
    });

    if (!user) return sendError(res, 404, "USER_NOT_FOUND", "Utilisateur introuvable");

    const publicUser = toPublicUser(user);
    if (!includeImage) {
      const { imageUrl: _imageUrl, ...rest } = publicUser;
      return sendSuccess(res, { ...rest, hasImage: !!publicUser.imageUrl });
    }

    return sendSuccess(res, publicUser);
  } catch (error) {
    console.error("getCurrentUser failed", error);
    return sendError(res, 500, "FETCH_FAILED", "Impossible de charger le profil");
  }
}

export async function updateCurrentUser(req: AuthRequest, res: Response) {
  if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Payload invalide"
    );
  }

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  try {
    const data = parsed.data;
    const user = await client.user.update({
      where: { id: req.user.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
      },
      select: userProfileSelect,
    });

    const publicUser = toPublicUser(user);
    if (data.imageUrl === undefined) {
      const { imageUrl: _imageUrl, ...rest } = publicUser;
      return sendSuccess(res, { ...rest, hasImage: !!publicUser.imageUrl });
    }

    return sendSuccess(res, publicUser);
  } catch (error) {
    console.error("updateCurrentUser failed", error);
    return sendError(res, 500, "UPDATE_FAILED", "Impossible de mettre à jour le profil");
  }
}
