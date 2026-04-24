import { z } from "zod";

export const bookingSchema = z
  .object({
    scheduleId: z.string().min(1),
    seatsBooked: z.coerce.number().int().min(1).optional(),
    selectedSeats: z.array(z.coerce.number().int().min(1)).optional(),
  })
  .refine((data) => (data.selectedSeats?.length ?? 0) > 0 || !!data.seatsBooked, {
    message: "Sélectionnez au moins une place",
  });

export const busSchema = z.object({
    plateNumber: z.string().min(3),
    model: z.string().optional(),
    totalSeats: z.coerce.number().int().min(1),
    companyId: z.string().min(1),
  });

export const updateBusSchema = z
  .object({
    plateNumber: z.string().min(3).optional(),
    model: z.string().optional(),
    totalSeats: z.coerce.number().int().min(1).optional(),
    companyId: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });

export const companySchema = z.object({
    name: z.string().min(2),
    phone: z.string().min(9),
    email: z.string().email(),
    address: z.string().optional(),
    description: z.string().optional(),
  });

export const updateCompanySchema = z
  .object({
    name: z.string().min(2).optional(),
    phone: z.string().min(9).optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });
export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });
export const paymentSchema = z.object({
    bookingId: z.string().min(1),
    method: z.enum(["MPESA", "AIRTEL_MONEY", "ORANGE_MONEY", "AFRI_MONEY"]),
    phoneNumber: z.string().min(9),
  });

export const registerSchema = z
  .object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(9).optional(),
    password: z.string().min(6),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export const routeSchema = z.object({
    departure: z.string().min(2),
    destination: z.string().min(2),
    price: z.coerce.number().positive(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    companyId: z.string().min(1),
  });

export const updateRouteSchema = z
  .object({
    departure: z.string().min(2).optional(),
    destination: z.string().min(2).optional(),
    price: z.coerce.number().positive().optional(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    companyId: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });
export const scheduleSchema = z.object({
    routeId: z.string().min(1),
    busId: z.string().min(1),
    departureTime: z.string().min(1),
    arrivalTime: z.string().optional(),
  });

export const updateScheduleSchema = z
  .object({
    routeId: z.string().min(1).optional(),
    busId: z.string().min(1).optional(),
    departureTime: z.string().min(1).optional(),
    arrivalTime: z.string().optional(),
    status: z.enum(["ACTIVE", "CANCELLED", "COMPLETED"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });