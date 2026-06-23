import type { Request, Response } from "express";
import { hash } from "bcryptjs";
import {
  createCompanyAdminSchema,
  updateCompanyAdminSchema,
} from "../models/schemas.js";
import { requirePlatformAdmin } from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";

function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function toCompanyAdminUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  companyId: string | null;
  createdAt: Date;
  company: { id: string; name: string } | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    companyId: user.companyId,
    companyName: user.company?.name ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

const companyAdminSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  companyId: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
} as const;

async function findCompanyAdmin(client: NonNullable<ReturnType<typeof getPrismaClient>>, id: string) {
  const user = await client.user.findUnique({
    where: { id },
    select: companyAdminSelect,
  });
  if (!user || user.role !== "COMPANY_ADMIN") return null;
  return user;
}

export async function listCompanyAdmins(req: Request, res: Response) {
  const admin = requirePlatformAdmin(req, res);
  if (!admin) return;

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const companyId =
    typeof req.query.companyId === "string" && req.query.companyId.trim()
      ? req.query.companyId.trim()
      : undefined;

  const admins = await client.user.findMany({
    where: {
      role: "COMPANY_ADMIN",
      ...(companyId ? { companyId } : {}),
    },
    select: companyAdminSelect,
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
  });

  return sendSuccess(res, admins.map(toCompanyAdminUser));
}

export async function createCompanyAdmin(req: Request, res: Response) {
  const platformAdmin = requirePlatformAdmin(req, res);
  if (!platformAdmin) return;

  const parsed = createCompanyAdminSchema.safeParse(req.body);
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

  const { name, email, phone, password, companyId } = parsed.data;

  const company = await client.transportCompany.findUnique({ where: { id: companyId } });
  if (!company) {
    return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");
  }

  const existing = await client.user.findUnique({ where: { email } });
  if (existing) {
    return sendError(res, 409, "EMAIL_ALREADY_EXISTS", "Un compte avec cet email existe déjà");
  }

  const passwordHash = await hash(password, 12);
  const user = await client.user.create({
    data: {
      name,
      email,
      phone,
      password: passwordHash,
      role: "COMPANY_ADMIN",
      companyId,
    },
    select: companyAdminSelect,
  });

  return sendSuccess(res, toCompanyAdminUser(user), 201);
}

export async function updateCompanyAdmin(req: Request, res: Response) {
  const platformAdmin = requirePlatformAdmin(req, res);
  if (!platformAdmin) return;

  const parsed = updateCompanyAdminSchema.safeParse(req.body);
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

  const id = String(req.params.id);
  const existing = await findCompanyAdmin(client, id);
  if (!existing) {
    return sendError(res, 404, "COMPANY_ADMIN_NOT_FOUND", "Administrateur société introuvable");
  }

  const data = parsed.data;

  if (data.companyId) {
    const company = await client.transportCompany.findUnique({ where: { id: data.companyId } });
    if (!company) {
      return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");
    }
  }

  if (data.email && data.email !== existing.email) {
    const emailTaken = await client.user.findUnique({ where: { email: data.email } });
    if (emailTaken) {
      return sendError(res, 409, "EMAIL_ALREADY_EXISTS", "Un compte avec cet email existe déjà");
    }
  }

  const passwordHash = data.password ? await hash(data.password, 12) : undefined;

  const user = await client.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.companyId !== undefined ? { companyId: data.companyId } : {}),
      ...(passwordHash ? { password: passwordHash } : {}),
    },
    select: companyAdminSelect,
  });

  return sendSuccess(res, toCompanyAdminUser(user));
}

export async function deleteCompanyAdmin(req: Request, res: Response) {
  const platformAdmin = requirePlatformAdmin(req, res);
  if (!platformAdmin) return;

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const id = String(req.params.id);
  const existing = await findCompanyAdmin(client, id);
  if (!existing) {
    return sendError(res, 404, "COMPANY_ADMIN_NOT_FOUND", "Administrateur société introuvable");
  }

  await client.user.delete({ where: { id } });
  return sendSuccess(res, { id, deleted: true });
}
