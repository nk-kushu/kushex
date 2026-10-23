import { defineConfig } from "prisma/config";

/** Like `prisma.config.ts`, but with a per-test migrations folder (see PrismaMigrator). */
const url = new URL(process.env["DATABASE_URL"] ?? "");
url.searchParams.set("schema", "kushex");

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: process.env["KUSHEX_TEST_MIGRATIONS_DIR"] ?? "" },
  datasource: { url: url.toString() },
});
