import { z } from "zod";

const genderEnum = z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]);

const passengerSchema = z.object({
  seatNumber: z.coerce.number().int().min(1),
  passengerName: z.string().min(2).optional(),
  gender: genderEnum.optional(),
  age: z.coerce.number().int().min(0).max(120),
  needsAssistance: z.boolean().default(false),
  assistanceNotes: z.string().max(500).optional(),
});

export const bookingSchema = z
  .object({
    scheduleId: z.string().min(1),
    seatsBooked: z.coerce.number().int().min(1).optional(),
    selectedSeats: z.array(z.coerce.number().int().min(1)).optional(),
    passengers: z.array(passengerSchema).optional(),
  })
  .refine((data) => (data.selectedSeats?.length ?? 0) > 0 || !!data.seatsBooked, {
    message: "Sélectionnez au moins une place",
  })
  .superRefine((data, ctx) => {
    if (!data.passengers || data.passengers.length === 0) return;

    const seats = data.selectedSeats ?? [];
    if (data.passengers.length !== seats.length) {
      ctx.addIssue({
        code: "custom",
        message: "Un passager par place sélectionnée",
        path: ["passengers"],
      });
      return;
    }

    const seatSet = new Set(seats);
    for (const [index, passenger] of data.passengers.entries()) {
      if (!seatSet.has(passenger.seatNumber)) {
        ctx.addIssue({
          code: "custom",
          message: `La place ${passenger.seatNumber} n'est pas sélectionnée`,
          path: ["passengers", index, "seatNumber"],
        });
      }
      if (passenger.needsAssistance && !passenger.assistanceNotes?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Précisez le type d'assistance requis",
          path: ["passengers", index, "assistanceNotes"],
        });
      }
    }
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

const imageDataUrlSchema = z
  .string()
  .max(500_000, "Image trop volumineuse (max ~350 Ko)")
  .refine(
    (value) =>
      value.startsWith("data:image/jpeg;base64,") ||
      value.startsWith("data:image/png;base64,") ||
      value.startsWith("data:image/webp;base64,"),
    { message: "Format d'image non supporté (JPEG, PNG ou WebP)" }
  );

export const companySchema = z.object({
    name: z.string().min(2),
    phone: z.string().min(9),
    email: z.string().email(),
    address: z.string().optional(),
    description: z.string().optional(),
    logo: imageDataUrlSchema.optional(),
  });

export const updateCompanySchema = z
  .object({
    name: z.string().min(2).optional(),
    phone: z.string().min(9).optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    logo: imageDataUrlSchema.nullable().optional(),
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

const profileImageUrlSchema = imageDataUrlSchema;

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).optional(),
    phone: z
      .union([z.string().min(9), z.literal("")])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    imageUrl: profileImageUrlSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });

export const bookingsTrendQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["day", "week", "month"]).optional().default("day"),
  status: z.enum(["CONFIRMED", "ALL"]).optional().default("CONFIRMED"),
  routeId: z.string().min(1).optional(),
});

export const usersTrendQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["day", "week", "month", "year"]).optional().default("month"),
});

export const adminUsersQuerySchema = z.object({
  search: z.string().max(120).optional(),
  role: z.enum(["CLIENT", "ADMIN", "COMPANY_ADMIN", "ALL"]).optional().default("CLIENT"),
  active: z.enum(["true", "false", "all"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const tripSearchQuerySchema = z.object({
  departure: z.string().min(2),
  destination: z.string().min(2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maxPrice: z.coerce.number().positive(),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timeTo: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  minSeats: z.coerce.number().int().min(1).optional().default(1),
});

export const routeLocationsQuerySchema = z.object({
  departure: z.string().min(2).optional(),
});

export const createCompanyAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(9).optional(),
  password: z.string().min(6),
  companyId: z.string().min(1, "Société requise"),
});

export const updateCompanyAdminSchema = z
  .object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z
      .union([z.string().min(9), z.literal("")])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    password: z.string().min(6).optional(),
    companyId: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Aucune donnée à mettre à jour",
  });

export const prelaunchLeadSchema = z
  .object({
    source: z.enum(["GENERAL", "PARTNER", "PILOT_KINSHASA_KIKWIT"]),
    name: z.string().trim().min(2, "Votre nom est requis").max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s().-]{9,24}$/, "Numéro de téléphone invalide")
      .transform((value) =>
        value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")
      ),
    email: z
      .union([z.string().trim().email("Adresse e-mail invalide"), z.literal("")])
      .optional()
      .transform((value) => value || undefined),
    companyName: z.string().trim().max(160).optional(),
    preferredRoute: z.string().trim().max(160).optional(),
    message: z.string().trim().max(1_000).optional(),
    consent: z.literal(true, {
      error: "Votre accord est requis pour rejoindre la liste",
    }),
    website: z.string().max(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.source === "PARTNER" && !data.companyName?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Le nom de la société est requis",
        path: ["companyName"],
      });
    }
  });