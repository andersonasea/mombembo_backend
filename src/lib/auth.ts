import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

export type UserRole = "ADMIN" | "COMPANY_ADMIN" | "CLIENT";

export type AuthUser = {
  id: string;
  role: UserRole;
  companyId?: string | null;
};

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? "change-me";
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  res.status(status).json({
    error: { code, message },
  });
}

export function parseAuthUser(req: Request): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    return jwt.verify(authHeader.slice(7), getJwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

export function isPlatformAdmin(user: AuthUser) {
  return user.role === "ADMIN";
}

export function isCompanyAdmin(user: AuthUser) {
  return user.role === "COMPANY_ADMIN";
}

export function canAccessAdminPanel(user: AuthUser) {
  return isPlatformAdmin(user) || isCompanyAdmin(user);
}

export function resolveListCompanyId(
  user: AuthUser | null,
  queryCompanyId?: string
): string | undefined {
  if (user && isCompanyAdmin(user) && user.companyId) {
    return user.companyId;
  }
  return queryCompanyId;
}

export function assertCompanyOwnership(
  user: AuthUser,
  resourceCompanyId: string,
  res: Response
): boolean {
  if (isPlatformAdmin(user)) return true;
  if (isCompanyAdmin(user) && user.companyId === resourceCompanyId) return true;
  sendError(res, 403, "FORBIDDEN", "Accès non autorisé pour cette société");
  return false;
}

export function requireAuth(req: Request, res: Response): AuthUser | null {
  const user = parseAuthUser(req);
  if (!user) {
    sendError(res, 401, "UNAUTHORIZED", "Token manquant ou invalide");
    return null;
  }
  return user;
}

/** ADMIN plateforme ou COMPANY_ADMIN (gestion back-office). */
export function requireAdminAccess(req: Request, res: Response): AuthUser | null {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!canAccessAdminPanel(user)) {
    sendError(res, 403, "FORBIDDEN", "Accès administrateur requis");
    return null;
  }
  if (isCompanyAdmin(user) && !user.companyId) {
    sendError(res, 403, "FORBIDDEN", "Compte société mal configuré");
    return null;
  }
  return user;
}

/** Uniquement l'administrateur Mobembo (plateforme). */
export function requirePlatformAdmin(req: Request, res: Response): AuthUser | null {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!isPlatformAdmin(user)) {
    sendError(res, 403, "FORBIDDEN", "Accès réservé à l'administrateur Mobembo");
    return null;
  }
  return user;
}

export function enforceCompanyIdOnCreate<T extends { companyId?: string }>(
  user: AuthUser,
  data: T
): T {
  if (isCompanyAdmin(user) && user.companyId) {
    return { ...data, companyId: user.companyId };
  }
  return data;
}
