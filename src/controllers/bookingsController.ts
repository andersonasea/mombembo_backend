import type { Request, Response } from "express"
import { Prisma, type PrismaClient } from "@prisma/client"
import { bookingSchema} from "../models/schemas.js"
import { toNumberValue } from "../lib/toNumberValue.js"
import type { AuthUser } from "../lib/auth.js"
import {
  isCompanyAdmin,
  isPlatformAdmin,
  requireAdminAccess,
  requireAuth,
} from "../lib/auth.js"
import { getPrismaClient } from "../lib/prisma.js"
import { syncPaymentWithProvider } from "../services/payment-sync.js"
import {
  activeSeatHoldWhere,
  getPendingBookingExpiryDate,
  releaseOrphanedSeatSelectionsForSchedule,
} from "../services/seat-release.js"

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

type AuthRequest = Request & { user?: AuthUser };

function requireAuthRequest(req: AuthRequest, res: Response): AuthUser | null {
  const user = requireAuth(req, res);
  if (user) req.user = user;
  return user;
}

/** Select passager — cast pour compatibilité si le client Prisma IDE est stale. */
const seatSelectionPassengerSelect = {
  seatNumber: true,
  passengerName: true,
  gender: true,
  age: true,
  needsAssistance: true,
  assistanceNotes: true,
} as unknown as Prisma.SeatSelectionSelect;

const bookingDetailInclude = {
  schedule: {
    include: {
      route: { include: { company: { select: { name: true } } } },
      bus: { select: { model: true, plateNumber: true } },
    },
  },
  seatSelections: { select: seatSelectionPassengerSelect },
  payment: true,
} as Prisma.BookingInclude;

async function loadBookingDetail(client: PrismaClient, bookingId: string) {
  try {
    return await client.booking.findUnique({
      where: { id: bookingId },
      include: bookingDetailInclude,
    });
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    return client.booking.findUnique({
      where: { id: bookingId },
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
}

export async function getAllBookings(req:Request,res:Response){
    const user = requireAdminAccess(req, res)
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
    
    const bookings = await client.booking.findMany({
        where: isCompanyAdmin(user) && user.companyId
          ? { schedule: { route: { companyId: user.companyId } } }
          : undefined,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          schedule: {
            include: {
              route: { include: { company: { select: { id: true, name: true } } } },
              bus: { select: { plateNumber: true, model: true } },
            },
          },
          payment: { select: { id: true, status: true, method: true, transactionRef: true } },
          seatSelections: { select: seatSelectionPassengerSelect },
        } as Prisma.BookingInclude,
        orderBy: { createdAt: "desc" },
})
return sendSuccess(res, toNumberValue(bookings));
}

export async function getBookingbyId(req: AuthRequest, res: Response) {
  try {
    const user = requireAuthRequest(req, res);
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

    try {
      await syncPaymentWithProvider(client, id);
    } catch (error) {
      console.warn("Payment sync skipped while loading booking", {
        bookingId: id,
        error: error instanceof Error ? error.message : error,
      });
    }

    const booking = await loadBookingDetail(client, id);

    if (!booking) return sendError(res, 404, "BOOKING_NOT_FOUND", "Réservation introuvable");
    if (!req.user) return sendError(res, 401, "UNAUTHORIZED", "Non autorisé");
    const bookingCompanyId = (
      booking as { schedule?: { route?: { companyId?: string } } }
    ).schedule?.route?.companyId;
    const isOwner = booking.userId === req.user.id;
    const isCompanyBookingAdmin =
      isCompanyAdmin(req.user) &&
      req.user.companyId &&
      bookingCompanyId === req.user.companyId;
    if (!isOwner && !isPlatformAdmin(req.user) && !isCompanyBookingAdmin) {
      return sendError(res, 403, "FORBIDDEN", "Accès non autorisé");
    }

    return sendSuccess(res, toNumberValue(booking));
  } catch (error) {
    console.error("getBookingbyId failed", {
      bookingId: req.params.id,
      error,
    });
    return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Erreur serveur");
  }
}

export async function createBooking(req:AuthRequest,res:Response){
    const user = requireAuthRequest(req, res)
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
    const passengersBySeat = new Map(
      (parsed.data.passengers ?? []).map((passenger) => [passenger.seatNumber, passenger])
    );
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
    const duplicateSeats = selectedSeats.filter((seat, index) => selectedSeats.indexOf(seat) !== index);
    if (duplicateSeats.length > 0) {
      return sendError(res, 400, "DUPLICATE_SEATS", "La sélection contient des places en double");
    }
    if (selectedSeats.some((seat) => seat > schedule.bus.totalSeats)) {
      return sendError(res, 400, "SEAT_OUT_OF_RANGE", "Une ou plusieurs places sont invalides");
    }
  
    try {
      const pendingExpiryDate = getPendingBookingExpiryDate();
      const result = await client.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: {
            scheduleId,
            status: "PENDING",
            createdAt: { lt: pendingExpiryDate },
          },
          data: { status: "CANCELLED" },
        });
        await releaseOrphanedSeatSelectionsForSchedule(tx, scheduleId, pendingExpiryDate);

        const txWithSeatSelection = tx as typeof tx & {
          seatSelection: {
            findMany(args: {
              where: {
                scheduleId: string;
                booking: ReturnType<typeof activeSeatHoldWhere>;
              };
              select: { seatNumber: true };
            }): Promise<Array<{ seatNumber: number }>>;
            createMany(args: {
              data: Array<{
                bookingId: string;
                scheduleId: string;
                seatNumber: number;
                passengerName?: string;
                gender?: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
                age?: number;
                needsAssistance?: boolean;
                assistanceNotes?: string | null;
              }>;
            }): Promise<{ count: number }>;
          };
        };
        const taken = await txWithSeatSelection.seatSelection.findMany({
          where: {
            scheduleId,
            booking: activeSeatHoldWhere(pendingExpiryDate),
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
          data: finalSeats.map((seatNumber) => {
            const passenger = passengersBySeat.get(seatNumber);
            return {
              bookingId: booking.id,
              scheduleId,
              seatNumber,
              passengerName: passenger?.passengerName,
              gender: passenger?.gender,
              age: passenger?.age,
              needsAssistance: passenger?.needsAssistance ?? false,
              assistanceNotes: passenger?.assistanceNotes?.trim() || null,
            };
          }),
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
          return newBooking;
        });
        return sendSuccess(res, toNumberValue(legacyBooking), 201);
      }
      throw error;
    }
}