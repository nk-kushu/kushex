import { defineConfig } from "prisma/config";

/** Kushex tables and `_prisma_migrations` live in this PostgreSQL schema, apart from Kushibot's. */
const KUSHEX_SCHEMA = "kushex";

function kushexSchemaUrl(url: string | undefined): string {
  if (!url) return ""; // `prisma generate` needs no database.
  const parsed = new URL(url);
  parsed.searchParams.set("schema", KUSHEX_SCHEMA);
  return parsed.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: kushexSchemaUrl(process.env["DATABASE_URL"]) },
});
