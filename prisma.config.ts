import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

dotenv.config({ path: path.join(process.cwd(), "../.env") });
dotenv.config({ override: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // CLI (migrate, seed) : connexion directe pour éviter la limite du pooler Supabase.
  // Le runtime utilise DATABASE_URL via pg-adapter.ts.
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]!,
  },
});
