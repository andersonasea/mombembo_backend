import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { adminUsersQuerySchema } from "../models/schemas.js";
import { requirePlatformAdmin } from "../lib/auth.js";
import { getPrismaClient } from "../lib/prisma.js";

const ACTIVE_WINDOW_DAYS = 90;

function sendSuccess<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ data, ...(meta ? { meta } : {}) });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function getActiveSinceDate() {
  return new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export async function listAdminUsers(req: Request, res: Response) {
  const admin = requirePlatformAdmin(req, res);
  if (!admin) return;

  const parsed = adminUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Paramètres invalides");
  }

  const client = getPrismaClient();
  if (!client) {
    return sendError(res, 500, "CONFIG_ERROR", "DATABASE_URL manquante");
  }

  const { search, role, active, page, limit } = parsed.data;
  const activeSince = getActiveSinceDate();
  const searchTerm = search?.trim();

  const where: Prisma.UserWhereInput = {
    ...(role !== "ALL" ? { role } : {}),
    ...(searchTerm
      ? {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } },
            { email: { contains: searchTerm, mode: "insensitive" } },
            { phone: { contains: searchTerm, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(active === "true"
      ? {
          bookings: {
            some: {
              status: "CONFIRMED",
              createdAt: { gte: activeSince },
            },
          },
        }
      : active === "false"
        ? {
            NOT: {
              bookings: {
                some: {
                  status: "CONFIRMED",
                  createdAt: { gte: activeSince },
                },
              },
            },
          }
        : {}),
  };

  const skip = (page - 1) * limit;

  const [total, users, activeCount, newThisMonth] = await Promise.all([
    client.user.count({ where }),
    client.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        loyaltyTier: true,
        loyaltyPoints: true,
        createdAt: true,
        _count: {
          select: {
            bookings: { where: { status: "CONFIRMED" } },
          },
        },
        bookings: {
          where: { status: "CONFIRMED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    client.user.count({
      where: {
        role: "CLIENT",
        bookings: {
          some: {
            status: "CONFIRMED",
            createdAt: { gte: activeSince },
          },
        },
      },
    }),
    client.user.count({
      where: {
        role: "CLIENT",
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),
  ]);

  const items = users.map((user) => {
    const lastBookingAt = user.bookings[0]?.createdAt ?? null;
    const isActive = lastBookingAt != null && lastBookingAt >= activeSince;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      loyaltyTier: user.loyaltyTier,
      loyaltyPoints: user.loyaltyPoints,
      bookingsCount: user._count.bookings,
      isActive,
      lastBookingAt: lastBookingAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  });

  return sendSuccess(res, items, {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    activeCount,
    newThisMonth,
    activeWindowDays: ACTIVE_WINDOW_DAYS,
  });
}
