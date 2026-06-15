import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import morgan from "morgan";
import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { createPrismaPgAdapter } from "./lib/pg-adapter.js";
import { loginSchema, registerSchema, paymentSchema } from "./models/schemas.js";
import {
  initiateFlexpayPayment,
  isFlexpayConfigured,
  validateFlexpayWebhookSecret,
} from "./services/flexpay.js";
import CompanyRoutes from "./routes/companyRoutes.js";
import BusRoutes from "./routes/busRoutes.js"
import BusDestination from "./routes/busDestination.js"
import BusSchedule from "./routes/busSchedule.js"
import BusBooking from "./routes/busBookings.js"
import { registerSwagger } from "./swagger.js";
import { toNumberValue } from "./lib/toNumberValue.js";
import type { AuthUser } from "./lib/auth.js";
dotenv.config();
dotenv.config({ path: "../.env" });

const app = express();
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the backend API.");
}
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(),
});

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "change-me";
const BOOKING_PENDING_TTL_MINUTES = Number(process.env.BOOKING_PENDING_TTL_MINUTES ?? 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${PORT}`;
const FLEXPAY_CALLBACK_URL =
  process.env.FLEXPAY_CALLBACK_URL ?? `${PUBLIC_API_BASE_URL}/api/payments/webhook/flexpay`;
const BACKEND_ORIGIN = new URL(PUBLIC_API_BASE_URL).origin;
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:58118", BACKEND_ORIGIN].join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors(
    {
      origin(origin, callback) {
        // Mobile native clients usually do not send Origin; allow those requests.
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS origin not allowed: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }
  )
);
app.use(morgan("dev"));
app.use(express.json());

// API versioning: expose v1 routes while keeping legacy /api compatibility.
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/v1/")) {
    req.url = req.url.replace("/api/v1/", "/api/");
  } else if (req.url === "/api/v1") {
    req.url = "/api";
  }
  next();
});

type AuthRequest = Request & { user?: AuthUser };

function signToken(user: AuthUser) {
  return jwt.sign(
    { id: user.id, role: user.role, companyId: user.companyId ?? null },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function toAuthUser(user: {
  id: string;
  role: AuthUser["role"];
  companyId?: string | null;
}): AuthUser {
  return {
    id: user.id,
    role: user.role,
    companyId: user.companyId ?? null,
  };
}

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  role: AuthUser["role"];
  companyId?: string | null;
  company?: { id: string; name: string } | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId ?? null,
    companyName: user.company?.name ?? null,
  };
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

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = {
      id: payload.id,
      role: payload.role,
      companyId: payload.companyId ?? null,
    };
    return next();
  } catch {
    return sendError(res, 401, "INVALID_TOKEN", "Token invalide");
  }
}

registerSwagger(app, PUBLIC_API_BASE_URL);

app.get("/api/health", (_req, res) => {
  return sendSuccess(res, { ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }

  const { name, email, phone, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return sendError(res, 409, "EMAIL_ALREADY_EXISTS", "Un compte avec cet email existe déjà");

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, phone, password: passwordHash },
  });

  const token = signToken(toAuthUser(user));
  return sendSuccess(
    res,
    {
      message: "Compte créé avec succès",
      token,
      user: toPublicUser(user),
    },
    201
  );
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return sendError(res, 401, "INVALID_CREDENTIALS", "Identifiants invalides");

  const isPasswordValid = await compare(password, user.password);
  if (!isPasswordValid) return sendError(res, 401, "INVALID_CREDENTIALS", "Identifiants invalides");

  const companyId = (user as { companyId?: string | null }).companyId ?? null;
  const company =
    companyId != null
      ? await prisma.transportCompany.findUnique({
          where: { id: companyId },
          select: { id: true, name: true },
        })
      : null;

  const token = signToken(toAuthUser(user));
  return sendSuccess(res, {
    token,
    user: toPublicUser({ ...user, company }),
  });
});
app.use("/api/companies", CompanyRoutes)
app.use("/api/buses", BusRoutes)
app.use("/api/routes", BusDestination)
app.use("/api/schedules", BusSchedule)
app.use("/api/bookings", BusBooking)

app.post("/api/payments", requireAuth, async (req: AuthRequest, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  }
  if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");

  const { bookingId, method, phoneNumber } = parsed.data;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });

  if (!booking) return sendError(res, 404, "BOOKING_NOT_FOUND", "Réservation introuvable");
  if (booking.userId !== req.user.id) return sendError(res, 403, "FORBIDDEN", "Accès non autorisé");
  if (
    booking.status === "PENDING" &&
    booking.createdAt < new Date(Date.now() - BOOKING_PENDING_TTL_MINUTES * 60 * 1000)
  ) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });
    return sendError(
      res,
      400,
      "BOOKING_EXPIRED",
      "La réservation a expiré. Veuillez recommencer la sélection de places."
    );
  }
  if (booking.status !== "PENDING") {
    return sendError(res, 400, "INVALID_BOOKING_STATUS", "Cette réservation n'est plus payable");
  }
  if (booking.payment) {
    return sendError(res, 400, "PAYMENT_ALREADY_EXISTS", "Un paiement existe déjà pour cette réservation");
  }

  if (!isFlexpayConfigured()) {
    return sendError(
      res,
      503,
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      "Flexpay n'est pas encore configuré sur le serveur"
    );
  }

  const merchantReference = `MOB-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currentUser = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { name: true, email: true },
  });

  const fullName = (currentUser?.name ?? "").trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "Client";
  const lastName = nameParts.slice(1).join(" ") || "Mobembo";

  const createdPayment = await prisma.payment.create({
    data: {
      bookingId,
      amount: booking.totalPrice,
      method,
      phoneNumber,
      transactionRef: merchantReference,
      status: "PENDING",
    },
  });

  try {
    const flexpayResponse = await initiateFlexpayPayment({
      amount: Number(booking.totalPrice),
      currency: "CDF",
      phoneNumber,
      method,
      reference: merchantReference,
      firstName,
      lastName,
      email: currentUser?.email ?? "client@mobembo.local",
      callbackUrl: FLEXPAY_CALLBACK_URL,
    });

    const updatedPayment = await prisma.payment.update({
      where: { id: createdPayment.id },
      data: {
        transactionRef: flexpayResponse.providerReference || merchantReference,
        status: flexpayResponse.status,
        paidAt: flexpayResponse.status === "SUCCESS" ? new Date() : null,
      },
    });

    if (flexpayResponse.status === "SUCCESS") {
      await prisma.$transaction(async (tx) => {
        const freshBooking = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { id: true, status: true, scheduleId: true, seatsBooked: true },
        });
        if (!freshBooking || freshBooking.status === "CONFIRMED") return;
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: "CONFIRMED" },
        });
        await tx.schedule.update({
          where: { id: freshBooking.scheduleId },
          data: { availableSeats: { decrement: freshBooking.seatsBooked } },
        });
      });
    }

    return sendSuccess(
      res,
      {
        ...toNumberValue(updatedPayment),
        provider: "FLEXPAY",
        bookingStatus: flexpayResponse.status === "SUCCESS" ? "CONFIRMED" : "PENDING",
      },
      201
    );
  } catch (error) {
    await prisma.payment.update({
      where: { id: createdPayment.id },
      data: { status: "FAILED" },
    });
    if (error instanceof Error && error.message.startsWith("FLEXPAY_INIT_FAILED:")) {
      const prefix = "FLEXPAY_INIT_FAILED:";
      const payload = error.message.slice(prefix.length);
      const separatorIndex = payload.indexOf(":");
      const statusCode = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : "unknown";
      const details = separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : "";
      console.error("Flexpay rejected payment request", { statusCode, details });
      return sendError(
        res,
        502,
        "FLEXPAY_ERROR",
        `Flexpay a rejeté la requête (status ${statusCode})`,
        details
      );
    }
    return sendError(
      res,
      502,
      "FLEXPAY_ERROR",
      error instanceof Error ? error.message : "Erreur lors de l'appel Flexpay"
    );
  }
});

app.post("/api/payments/webhook/flexpay", async (req, res) => {
  if (!validateFlexpayWebhookSecret(req.headers as Record<string, unknown>)) {
    return sendError(res, 401, "INVALID_WEBHOOK_SIGNATURE", "Webhook Flexpay non autorisé");
  }

  const payload = req.body as {
    providerReference?: string;
    transactionRef?: string;
    reference?: string;
    orderNumber?: string;
    status?: string;
    state?: string;
    result?: string;
  };

  const reference =
    payload.providerReference ?? payload.transactionRef ?? payload.reference ?? payload.orderNumber;
  if (!reference) {
    return sendError(res, 400, "INVALID_PAYLOAD", "Référence de transaction manquante");
  }

  const normalized = String(payload.status ?? payload.state ?? payload.result ?? "").toUpperCase();
  const isSuccess = ["SUCCESS", "SUCCEEDED", "PAID", "COMPLETED"].includes(normalized);
  const status = isSuccess ? "SUCCESS" : "FAILED";

  const payment = await prisma.payment.findFirst({
    where: { transactionRef: reference },
    include: { booking: true },
  });

  if (!payment) {
    return sendError(res, 404, "PAYMENT_NOT_FOUND", "Paiement introuvable");
  }

  await prisma.$transaction(async (tx) => {
    const freshBooking = await tx.booking.findUnique({
      where: { id: payment.bookingId },
      select: { id: true, status: true, scheduleId: true, seatsBooked: true },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status, paidAt: isSuccess ? new Date() : null },
    });
    if (isSuccess && freshBooking && freshBooking.status !== "CONFIRMED") {
      await tx.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CONFIRMED" },
      });
      await tx.schedule.update({
        where: { id: freshBooking.scheduleId },
        data: { availableSeats: { decrement: freshBooking.seatsBooked } },
      });
    }
  });

  return sendSuccess(res, { received: true });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  sendError(res, 500, "INTERNAL_SERVER_ERROR", "Erreur serveur");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mobembo API listening on port ${PORT}`);
});
