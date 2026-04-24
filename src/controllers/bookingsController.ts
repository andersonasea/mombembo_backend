import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import type { Request, Response } from "express"
import jwt from "jsonwebtoken"
import { Prisma } from "@prisma/client"
import { scheduleSchema, updateScheduleSchema,bookingSchema} from "../models/schemas.js"

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
function isMissingTableError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

type AuthUser = { id: string; role: "ADMIN" | "CLIENT" };
type AuthRequest = Request & { user?: AuthUser };

function requireAdmin(req: Request, res: Response) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendError(res, 401, "UNAUTHORIZED", "Token manquant");
        return null;
    }
    const token = authHeader.slice(7);
    const jwtSecret = process.env.JWT_SECRET ?? "change-me";
    try {
        const payload = jwt.verify(token, jwtSecret) as AuthUser;
        if (payload.role !== "ADMIN") {
            sendError(res, 403, "FORBIDDEN", "Accès administrateur requis");
            return null;
        }
        return payload;
    } catch {
        sendError(res, 401, "UNAUTHORIZED", "Token invalide");
        return null;
    }
}

export async function getAllBookings(req:Request,res:Response){
    const client = getPrismaClient();
    if (!client) {
        return res.status(500).json({
            error: {
                code: "CONFIG_ERROR",
                message: "DATABASE_URL is required to start the backend API.",
            },
        });
    }
    
    const bookings = await client.booking.findMany({
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          schedule: {
            include: {
              route: { include: { company: { select: { id: true, name: true } } } },
              bus: { select: { plateNumber: true, model: true } },
            },
          },
          payment: { select: { id: true, status: true, method: true, transactionRef: true } },
        },
        orderBy: { createdAt: "desc" },
})
return sendSuccess(res, toNumberValue(bookings));
}

export async function getBookingbyId(req:AuthRequest,res:Response) {
    const user = requireAdmin(req, res)
  if (!user) {
    return;
  }
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
    let booking;
    try {
      booking = await client.booking.findUnique({
        where: { id },
        include: {
          schedule: {
            include: {
              route: { include: { company: { select: { name: true } } } },
              bus: { select: { model: true, plateNumber: true } },
            },
          },
          seatSelections: { select: { seatNumber: true } },
          payment: true,
        } as Prisma.BookingInclude,
      });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      booking = await client.booking.findUnique({
        where: { id },
        include: {
          schedule: {
            include: {
              route: { include: { company: { select: { name: true } } } },
              bus: { select: { model: true, plateNumber: true } },
            },
          },
          payment: true,
        },
      });
    }
  
    if (!booking) return sendError(res, 404, "BOOKING_NOT_FOUND", "Réservation introuvable");
    if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
    if (booking.userId !== req.user.id && req.user.role !== "ADMIN") {
      return sendError(res, 403, "FORBIDDEN", "Accès non autorisé");
    }
  
    return sendSuccess(res, toNumberValue(booking));
    
}

export async function createBooking(req:AuthRequest,res:Response){
    const user = requireAdmin(req, res)
    if (!user) {
      return;
    }
    const client = getPrismaClient();
    if (!client) {
      return res.status(500).json({
        error: {
          code: "CONFIG_ERROR",
          message: "DATABASE_URL is required to start the backend API.",
        },
      });
    }
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload invalide");
    }
    if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
  
    const { scheduleId } = parsed.data;
    const selectedSeats = parsed.data.selectedSeats ?? [];
    const requestedSeatsCount = selectedSeats.length > 0 ? selectedSeats.length : parsed.data.seatsBooked!;
    const schedule = await client.schedule.findUnique({
      where: { id: scheduleId },
      include: { route: true, bus: { select: { totalSeats: true } } },
    });
  
    if (!schedule) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "Horaire introuvable");
    if (schedule.status !== "ACTIVE") return sendError(res, 400, "SCHEDULE_NOT_ACTIVE", "Cet horaire n'est plus disponible");
    if (new Date(schedule.departureTime) <= new Date()) {
      return sendError(res, 400, "SCHEDULE_EXPIRED", "L'heure de départ est déjà passée");
    }
    if (schedule.availableSeats < requestedSeatsCount) {
      return sendError(
        res,
        400,
        "INSUFFICIENT_SEATS",
        `Seulement ${schedule.availableSeats} place(s) disponible(s)`
      );
    }
  
    const duplicateSeats = selectedSeats.filter((seat, index) => selectedSeats.indexOf(seat) !== index);
    if (duplicateSeats.length > 0) {
      return sendError(res, 400, "DUPLICATE_SEATS", "La sélection contient des places en double");
    }
    if (selectedSeats.some((seat) => seat > schedule.bus.totalSeats)) {
      return sendError(res, 400, "SEAT_OUT_OF_RANGE", "Une ou plusieurs places sont invalides");
    }
  
    try {
      const result = await client.$transaction(async (tx) => {
        const txWithSeatSelection = tx as typeof tx & {
          seatSelection: {
            findMany(args: {
              where: { scheduleId: string; booking: { status: { not: "CANCELLED" } } };
              select: { seatNumber: true };
            }): Promise<Array<{ seatNumber: number }>>;
            createMany(args: {
              data: Array<{ bookingId: string; scheduleId: string; seatNumber: number }>;
            }): Promise<{ count: number }>;
          };
        };
        const taken = await txWithSeatSelection.seatSelection.findMany({
          where: {
            scheduleId,
            booking: { status: { not: "CANCELLED" } },
          },
          select: { seatNumber: true },
        });
        const takenSet = new Set<number>(taken.map((seat) => seat.seatNumber));
  
        let finalSeats: number[];
        if (selectedSeats.length > 0) {
          const conflicts = selectedSeats.filter((seat) => takenSet.has(seat));
          if (conflicts.length > 0) {
            throw new Error(`SEAT_ALREADY_TAKEN:${conflicts.join(",")}`);
          }
          finalSeats = selectedSeats;
        } else {
          finalSeats = [];
          for (let seat = 1; seat <= schedule.bus.totalSeats; seat++) {
            if (!takenSet.has(seat)) finalSeats.push(seat);
            if (finalSeats.length === requestedSeatsCount) break;
          }
          if (finalSeats.length < requestedSeatsCount) {
            throw new Error("INSUFFICIENT_SEATS");
          }
        }
  
        const totalPrice = Number(schedule.route.price) * finalSeats.length;
        const booking = await tx.booking.create({
          data: {
            userId: req.user!.id,
            scheduleId,
            seatsBooked: finalSeats.length,
            totalPrice,
          },
        });
        await txWithSeatSelection.seatSelection.createMany({
          data: finalSeats.map((seatNumber) => ({
            bookingId: booking.id,
            scheduleId,
            seatNumber,
          })),
        });
        await tx.schedule.update({
          where: { id: scheduleId },
          data: { availableSeats: { decrement: finalSeats.length } },
        });
  
        return { booking, finalSeats };
      });
  
      return sendSuccess(res, toNumberValue({ ...result.booking, selectedSeats: result.finalSeats }), 201);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SEAT_ALREADY_TAKEN:")) {
        const seats = error.message.replace("SEAT_ALREADY_TAKEN:", "");
        return sendError(res, 409, "SEAT_ALREADY_TAKEN", `Place(s) déjà réservée(s): ${seats}`);
      }
      if (error instanceof Error && error.message === "INSUFFICIENT_SEATS") {
        return sendError(res, 400, "INSUFFICIENT_SEATS", "Plus assez de places disponibles");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return sendError(res, 409, "SEAT_ALREADY_TAKEN", "Une place vient d'être réservée, veuillez réessayer");
      }
      if (isMissingTableError(error)) {
        const totalPrice = Number(schedule.route.price) * requestedSeatsCount;
        const legacyBooking = await client.$transaction(async (tx) => {
          const newBooking = await tx.booking.create({
            data: {
              userId: req.user!.id,
              scheduleId,
              seatsBooked: requestedSeatsCount,
              totalPrice,
            },
          });
          await tx.schedule.update({
            where: { id: scheduleId },
            data: { availableSeats: { decrement: requestedSeatsCount } },
          });
          return newBooking;
        });
        return sendSuccess(res, toNumberValue(legacyBooking), 201);
      }
      throw error;
    }
}