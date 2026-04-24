import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import morgan from "morgan";
import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {loginSchema,registerSchema,paymentSchema} from "./models/schemas.js";
import CompanyRoutes from "./routes/companyRoutes.js";
import BusRoutes from "./routes/busRoutes.js"
import BusDestination from "./routes/busDestination.js"
import BusSchedule from "./routes/busSchedule.js"
import BusBooking from "./routes/busBookings.js"
import { registerSwagger } from "./swagger.js";
dotenv.config();
dotenv.config({ path: "../.env" });

const app = express();
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the backend API.");
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PORT = Number(process.env.API_PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "change-me";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${PORT}`;
const BACKEND_ORIGIN = new URL(PUBLIC_API_BASE_URL).origin;
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:58118", BACKEND_ORIGIN].join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Mobile native clients usually do not send Origin; allow those requests.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
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

type AuthUser = { id: string; role: "ADMIN" | "CLIENT" };
type AuthRequest = Request & { user?: AuthUser };

function signToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
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

function isMissingTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function toNumberValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => toNumberValue(item)) as T;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, item]) => {
      if (item && typeof item === "object" && "toNumber" in (item as object)) {
        out[key] = Number(item);
      } else {
        out[key] = toNumberValue(item);
      }
    });
    return out as T;
  }
  return value;
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, role: payload.role };
    return next();
  } catch {
    return sendError(res, 401, "INVALID_TOKEN", "Token invalide");
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return sendError(res, 403, "FORBIDDEN", "Non autorisé");
  }
  return next();
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

  const token = signToken({ id: user.id, role: user.role });
  return sendSuccess(
    res,
    {
    message: "Compte créé avec succès",
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
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

  const token = signToken({ id: user.id, role: user.role });
  return sendSuccess(res, {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

//  app.get("/api/companies", async (_req, res) => {
//    const companies = await prisma.transportCompany.findMany({
//      include: { _count: { select: { buses: true, routes: true } } },
//      orderBy: { name: "asc" },
//    });
//    return sendSuccess(res, companies);
// });
app.use("/api/companies", CompanyRoutes)
app.use("/api/buses",BusRoutes)

  // app.post("/api/companies", requireAuth, requireAdmin, async (req, res) => {
  //  const parsed = companySchema.safeParse(req.body);
  //  if (!parsed.success) {
  //    return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
  //  }

  //   const company = await prisma.transportCompany.create({ data: parsed.data });
  //   return sendSuccess(res, company, 201);
  // });
//app.use("/api/companies",CompanyRoutes)
// app.patch("/api/companies/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const parsed = updateCompanySchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const existing = await prisma.transportCompany.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");

//   const company = await prisma.transportCompany.update({
//     where: { id },
//     data: parsed.data,
//   });
//   return sendSuccess(res, company);
// });

// app.delete("/api/companies/:id", requireAuth, requireAdmin, async (req, res) => {
//    const id = String(req.params.id);
//    const existing = await prisma.transportCompany.findUnique({ where: { id } });
//    if (!existing) return sendError(res, 404, "COMPANY_NOT_FOUND", "Société introuvable");

//    await prisma.transportCompany.delete({ where: { id } });
//    return sendSuccess(res, { id, deleted: true });
//  });
//app.use("/api/companies",CompanyRoutes)

// app.get("/api/buses", async (req, res) => {
//   const companyId = req.query.companyId as string | undefined;
//   const buses = await prisma.bus.findMany({
//     where: companyId ? { companyId } : undefined,
//     include: { company: { select: { name: true } } },
//     orderBy: { createdAt: "desc" },
//   });
//   return sendSuccess(res, buses);
// });

// app.post("/api/buses", requireAuth, requireAdmin, async (req, res) => {
//   const parsed = busSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const bus = await prisma.bus.create({ data: parsed.data });
//   return sendSuccess(res, bus, 201);
// });

// app.delete("/api/buses/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const existing = await prisma.bus.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");

//   await prisma.bus.delete({ where: { id } });
//   return sendSuccess(res, { id, deleted: true });
// });

// app.patch("/api/buses/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const parsed = updateBusSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const existing = await prisma.bus.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");

//   const bus = await prisma.bus.update({
//     where: { id },
//     data: parsed.data,
//   });
//   return sendSuccess(res, bus);
// });


// app.get("/api/routes", async (req, res) => {
//   const companyId = req.query.companyId as string | undefined;
//   const routes = await prisma.route.findMany({
//     where: companyId ? { companyId } : undefined,
//     include: { company: { select: { name: true } } },
//     orderBy: { departure: "asc" },
//   });
//   return sendSuccess(res, toNumberValue(routes));
// });

// app.post("/api/routes", requireAuth, requireAdmin, async (req, res) => {
//   const parsed = routeSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const route = await prisma.route.create({ data: parsed.data });
//   return sendSuccess(res, toNumberValue(route), 201);
// });

// app.patch("/api/routes/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const parsed = updateRouteSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const existing = await prisma.route.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");

//   const route = await prisma.route.update({
//     where: { id },
//     data: parsed.data,
//   });
//   return sendSuccess(res, toNumberValue(route));
// });

// app.delete("/api/routes/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const existing = await prisma.route.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "ROUTE_NOT_FOUND", "Trajet introuvable");

//   await prisma.route.delete({ where: { id } });
//   return sendSuccess(res, { id, deleted: true });
// });

app.use("/api/routes",BusDestination)
app.use("/api/schedules",BusSchedule)

// app.get("/api/schedules", async (req, res) => {
//   const routeId = req.query.routeId as string | undefined;
//   const schedules = await prisma.schedule.findMany({
//     where: routeId
//       ? {
//           routeId,
//           status: "ACTIVE",
//           departureTime: { gte: new Date() },
//           availableSeats: { gt: 0 },
//         }
//       : undefined,
//     include: {
//       route: { include: { company: { select: { name: true } } } },
//       bus: { select: { id: true, plateNumber: true, model: true, totalSeats: true } },
//     },
//     orderBy: { departureTime: "asc" },
//   });
//   return sendSuccess(res, toNumberValue(schedules));
// });

// app.get("/api/schedules/:id", async (req, res) => {
//   const id = String(req.params.id);
//   let schedule;
//   try {
//     schedule = await prisma.schedule.findUnique({
//       where: { id },
//       include: {
//         route: { include: { company: { select: { id: true, name: true } } } },
//         bus: { select: { plateNumber: true, model: true, totalSeats: true } },
//         seatSelections: {
//           where: { booking: { status: { not: "CANCELLED" } } },
//           select: { seatNumber: true },
//         },
//       } as Prisma.ScheduleInclude,
//     });
//   } catch (error) {
//     if (!isMissingTableError(error)) throw error;
//     schedule = await prisma.schedule.findUnique({
//       where: { id },
//       include: {
//         route: { include: { company: { select: { id: true, name: true } } } },
//         bus: { select: { plateNumber: true, model: true, totalSeats: true } },
//       },
//     });
//   }

//   if (!schedule) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
//   return sendSuccess(res, toNumberValue(schedule));
// });

// app.post("/api/schedules", requireAuth, requireAdmin, async (req, res) => {
//   const parsed = scheduleSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const bus = await prisma.bus.findUnique({ where: { id: parsed.data.busId } });
//   if (!bus) return sendError(res, 404, "BUS_NOT_FOUND", "Bus introuvable");

//   const schedule = await prisma.schedule.create({
//     data: {
//       routeId: parsed.data.routeId,
//       busId: parsed.data.busId,
//       departureTime: new Date(parsed.data.departureTime),
//       arrivalTime: parsed.data.arrivalTime ? new Date(parsed.data.arrivalTime) : null,
//       availableSeats: bus.totalSeats,
//     },
//   });
//   return sendSuccess(res, schedule, 201);
// });

// app.patch("/api/schedules/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const parsed = updateScheduleSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }

//   const existing = await prisma.schedule.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");

//   const data = {
//     ...(parsed.data.routeId ? { routeId: parsed.data.routeId } : {}),
//     ...(parsed.data.busId ? { busId: parsed.data.busId } : {}),
//     ...(parsed.data.departureTime ? { departureTime: new Date(parsed.data.departureTime) } : {}),
//     ...(parsed.data.arrivalTime !== undefined
//       ? { arrivalTime: parsed.data.arrivalTime ? new Date(parsed.data.arrivalTime) : null }
//       : {}),
//     ...(parsed.data.status ? { status: parsed.data.status } : {}),
//   };

//   const schedule = await prisma.schedule.update({
//     where: { id },
//     data,
//   });
//   return sendSuccess(res, schedule);
// });

// app.delete("/api/schedules/:id", requireAuth, requireAdmin, async (req, res) => {
//   const id = String(req.params.id);
//   const existing = await prisma.schedule.findUnique({ where: { id } });
//   if (!existing) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");

//   await prisma.schedule.delete({ where: { id } });
//   return sendSuccess(res, { id, deleted: true });
// });

// app.post("/api/bookings", requireAuth, async (req: AuthRequest, res) => {
//   const parsed = bookingSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
//   }
//   if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");

//   const { scheduleId } = parsed.data;
//   const selectedSeats = parsed.data.selectedSeats ?? [];
//   const requestedSeatsCount = selectedSeats.length > 0 ? selectedSeats.length : parsed.data.seatsBooked!;
//   const schedule = await prisma.schedule.findUnique({
//     where: { id: scheduleId },
//     include: { route: true, bus: { select: { totalSeats: true } } },
//   });

//   if (!schedule) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
//   if (schedule.status !== "ACTIVE") return sendError(res, 400, "SCHEDULE_NOT_ACTIVE", "Cet horaire n'est plus disponible");
//   if (new Date(schedule.departureTime) <= new Date()) {
//     return sendError(res, 400, "SCHEDULE_EXPIRED", "L'heure de départ est déjà passée");
//   }
//   if (schedule.availableSeats < requestedSeatsCount) {
//     return sendError(
//       res,
//       400,
//       "INSUFFICIENT_SEATS",
//       `Seulement ${schedule.availableSeats} place(s) disponible(s)`
//     );
//   }

//   const duplicateSeats = selectedSeats.filter((seat, index) => selectedSeats.indexOf(seat) !== index);
//   if (duplicateSeats.length > 0) {
//     return sendError(res, 400, "DUPLICATE_SEATS", "La sélection contient des places en double");
//   }
//   if (selectedSeats.some((seat) => seat > schedule.bus.totalSeats)) {
//     return sendError(res, 400, "SEAT_OUT_OF_RANGE", "Une ou plusieurs places sont invalides");
//   }

//   try {
//     const result = await prisma.$transaction(async (tx) => {
//       const txWithSeatSelection = tx as typeof tx & {
//         seatSelection: {
//           findMany(args: {
//             where: { scheduleId: string; booking: { status: { not: "CANCELLED" } } };
//             select: { seatNumber: true };
//           }): Promise<Array<{ seatNumber: number }>>;
//           createMany(args: {
//             data: Array<{ bookingId: string; scheduleId: string; seatNumber: number }>;
//           }): Promise<{ count: number }>;
//         };
//       };
//       const taken = await txWithSeatSelection.seatSelection.findMany({
//         where: {
//           scheduleId,
//           booking: { status: { not: "CANCELLED" } },
//         },
//         select: { seatNumber: true },
//       });
//       const takenSet = new Set<number>(taken.map((seat) => seat.seatNumber));

//       let finalSeats: number[];
//       if (selectedSeats.length > 0) {
//         const conflicts = selectedSeats.filter((seat) => takenSet.has(seat));
//         if (conflicts.length > 0) {
//           throw new Error(`SEAT_ALREADY_TAKEN:${conflicts.join(",")}`);
//         }
//         finalSeats = selectedSeats;
//       } else {
//         finalSeats = [];
//         for (let seat = 1; seat <= schedule.bus.totalSeats; seat++) {
//           if (!takenSet.has(seat)) finalSeats.push(seat);
//           if (finalSeats.length === requestedSeatsCount) break;
//         }
//         if (finalSeats.length < requestedSeatsCount) {
//           throw new Error("INSUFFICIENT_SEATS");
//         }
//       }

//       const totalPrice = Number(schedule.route.price) * finalSeats.length;
//       const booking = await tx.booking.create({
//         data: {
//           userId: req.user!.id,
//           scheduleId,
//           seatsBooked: finalSeats.length,
//           totalPrice,
//         },
//       });
//       await txWithSeatSelection.seatSelection.createMany({
//         data: finalSeats.map((seatNumber) => ({
//           bookingId: booking.id,
//           scheduleId,
//           seatNumber,
//         })),
//       });
//       await tx.schedule.update({
//         where: { id: scheduleId },
//         data: { availableSeats: { decrement: finalSeats.length } },
//       });

//       return { booking, finalSeats };
//     });

//     return sendSuccess(res, toNumberValue({ ...result.booking, selectedSeats: result.finalSeats }), 201);
//   } catch (error) {
//     if (error instanceof Error && error.message.startsWith("SEAT_ALREADY_TAKEN:")) {
//       const seats = error.message.replace("SEAT_ALREADY_TAKEN:", "");
//       return sendError(res, 409, "SEAT_ALREADY_TAKEN", `Place(s) déjà réservée(s): ${seats}`);
//     }
//     if (error instanceof Error && error.message === "INSUFFICIENT_SEATS") {
//       return sendError(res, 400, "INSUFFICIENT_SEATS", "Plus assez de places disponibles");
//     }
//     if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
//       return sendError(res, 409, "SEAT_ALREADY_TAKEN", "Une place vient d'être réservée, veuillez réessayer");
//     }
//     if (isMissingTableError(error)) {
//       const totalPrice = Number(schedule.route.price) * requestedSeatsCount;
//       const legacyBooking = await prisma.$transaction(async (tx) => {
//         const newBooking = await tx.booking.create({
//           data: {
//             userId: req.user!.id,
//             scheduleId,
//             seatsBooked: requestedSeatsCount,
//             totalPrice,
//           },
//         });
//         await tx.schedule.update({
//           where: { id: scheduleId },
//           data: { availableSeats: { decrement: requestedSeatsCount } },
//         });
//         return newBooking;
//       });
//       return sendSuccess(res, toNumberValue(legacyBooking), 201);
//     }
//     throw error;
//   }
// });

// app.get("/api/bookings", requireAuth, requireAdmin, async (_req, res) => {
//   const bookings = await prisma.booking.findMany({
//     include: {
//       user: { select: { id: true, name: true, email: true, phone: true } },
//       schedule: {
//         include: {
//           route: { include: { company: { select: { id: true, name: true } } } },
//           bus: { select: { plateNumber: true, model: true } },
//         },
//       },
//       payment: { select: { id: true, status: true, method: true, transactionRef: true } },
//     },
//     orderBy: { createdAt: "desc" },
//   });
//   return sendSuccess(res, toNumberValue(bookings));
// });

// app.get("/api/bookings/:id", requireAuth, async (req: AuthRequest, res) => {
//   const id = String(req.params.id);
//   let booking;
//   try {
//     booking = await prisma.booking.findUnique({
//       where: { id },
//       include: {
//         schedule: {
//           include: {
//             route: { include: { company: { select: { name: true } } } },
//             bus: { select: { model: true, plateNumber: true } },
//           },
//         },
//         seatSelections: { select: { seatNumber: true } },
//         payment: true,
//       } as Prisma.BookingInclude,
//     });
//   } catch (error) {
//     if (!isMissingTableError(error)) throw error;
//     booking = await prisma.booking.findUnique({
//       where: { id },
//       include: {
//         schedule: {
//           include: {
//             route: { include: { company: { select: { name: true } } } },
//             bus: { select: { model: true, plateNumber: true } },
//           },
//         },
//         payment: true,
//       },
//     });
//   }

//   if (!booking) return sendError(res, 404, "BOOKING_NOT_FOUND", "Réservation introuvable");
//   if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
//   if (booking.userId !== req.user.id && req.user.role !== "ADMIN") {
//     return sendError(res, 403, "FORBIDDEN", "Accès non autorisé");
//   }

//   return sendSuccess(res, toNumberValue(booking));
// });
app.use("/api/bookings",BusBooking)

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
  if (booking.payment) {
    return sendError(res, 400, "PAYMENT_ALREADY_EXISTS", "Un paiement existe déjà pour cette réservation");
  }

  const transactionRef = `MOB-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const payment = await prisma.$transaction(async (tx) => {
    const newPayment = await tx.payment.create({
      data: {
        bookingId,
        amount: booking.totalPrice,
        method,
        phoneNumber,
        transactionRef,
        status: "PENDING",
      },
    });
    await tx.payment.update({
      where: { id: newPayment.id },
      data: { status: "SUCCESS", paidAt: new Date() },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    });
    return newPayment;
  });

  return sendSuccess(res, { ...toNumberValue(payment), status: "SUCCESS" }, 201);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  sendError(res, 500, "INTERNAL_SERVER_ERROR", "Erreur serveur");
});

app.listen(PORT, () => {
  console.log(`Mobembo API listening on http://localhost:${PORT}`);
});
