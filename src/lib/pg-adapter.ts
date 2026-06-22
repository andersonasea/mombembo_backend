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

  const isSupabasePooler = connectionString.includes("pooler.supabase.com");
  const poolOptions: pg.PoolConfig = {
    connectionString: stripSslMode(connectionString),
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    // Session pooler Supabase : max 15 connexions partagées — garder le pool petit.
    ...(isSupabasePooler ? { max: 3, idleTimeoutMillis: 20_000 } : {}),
  };

  if (needsSsl || isSupabasePooler) {
    const pool = new pg.Pool(poolOptions);
    return new PrismaPg(pool);
  }

  return new PrismaPg({ connectionString });
}
