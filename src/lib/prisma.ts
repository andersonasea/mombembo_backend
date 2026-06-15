import { PrismaClient } from "@prisma/client";
import { createPrismaPgAdapter } from "./pg-adapter.js";

let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!prisma) {
    prisma = new PrismaClient({
      adapter: createPrismaPgAdapter(),
    });
  }
  return prisma;
}
