import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

function stripSslMode(connectionString: string): string {
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  return url.toString();
}

export function createPrismaPgAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const needsSsl =
    connectionString.includes("supabase.com") ||
    /sslmode=(require|verify-full|prefer)/i.test(connectionString);

  if (needsSsl) {
    const pool = new pg.Pool({
      connectionString: stripSslMode(connectionString),
      ssl: { rejectUnauthorized: false },
    });
    return new PrismaPg(pool);
  }

  return new PrismaPg({ connectionString });
}
