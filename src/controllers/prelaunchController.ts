import type { Request, Response } from "express";
import { getPrismaClient } from "../lib/prisma.js";
import { prelaunchLeadSchema } from "../models/schemas.js";

export async function createPrelaunchLead(req: Request, res: Response) {
  const parsed = prelaunchLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Informations invalides",
      },
    });
  }

  const prisma = getPrismaClient();
  if (!prisma) {
    return res.status(503).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Les inscriptions sont momentanément indisponibles",
      },
    });
  }

  const {
    source,
    name,
    phone,
    email,
    companyName,
    preferredRoute,
    message,
    consent,
  } = parsed.data;

  try {
    const lead = await prisma.prelaunchLead.upsert({
      where: {
        source_phone: { source, phone },
      },
      create: {
        source,
        name,
        phone,
        email,
        companyName,
        preferredRoute,
        message,
        consent,
      },
      update: {
        name,
        email,
        companyName,
        preferredRoute,
        message,
        consent,
      },
      select: {
        id: true,
        source: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      data: {
        ...lead,
        message: "Merci ! Votre inscription au pré-lancement est confirmée.",
      },
    });
  } catch (error) {
    console.error("Prelaunch lead creation failed", error);
    return res.status(500).json({
      error: {
        code: "LEAD_CREATION_FAILED",
        message: "Impossible d'enregistrer votre inscription pour le moment",
      },
    });
  }
}
