import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ReadinessCheck, ReadinessCheckResult } from "../../app/health/ReadinessCheck.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

type MigrationRecord = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/**
 * Compares the migrations shipped in `prisma/migrations` with Prisma's `_prisma_migrations`
 * table, without running the CLI. Not ready until `prisma migrate deploy` has applied every
 * migration, or when an applied migration failed, was edited, or is missing from this build.
 */
export class PrismaMigrationReadinessCheck implements ReadinessCheck {
  readonly name = "migrations";

  constructor(
    private readonly client: PrismaClient,
    private readonly migrationsDirectory: string,
  ) {}

  async check(): Promise<ReadinessCheckResult> {
    const shipped = await this.readShippedChecksums();
    const records = await this.readRecords();

    const failed = records.find((record) => !record.finished_at && !record.rolled_back_at);
    if (failed) {
      return {
        ready: false,
        reason: `Migration ${failed.migration_name} failed or is still running; resolve it with prisma migrate resolve.`,
      };
    }
    const applied = records.filter((record) => record.finished_at && !record.rolled_back_at);
    for (const record of applied) {
      const checksum = shipped.get(record.migration_name);
      if (checksum === undefined) {
        return {
          ready: false,
          reason: `Database has migration ${record.migration_name} applied, but this build does not contain it.`,
        };
      }
      if (checksum !== record.checksum) {
        return {
          ready: false,
          reason: `Migration ${record.migration_name} was modified after it was applied.`,
        };
      }
    }
    const appliedNames = new Set(applied.map((record) => record.migration_name));
    const pending = [...shipped.keys()].filter((name) => !appliedNames.has(name));
    return pending.length === 0
      ? { ready: true }
      : {
          ready: false,
          reason: `${pending.length} pending migration(s); run the migrate command.`,
        };
  }

  /** Migration folder name -> SHA-256 of its `migration.sql`, as Prisma records it. */
  private async readShippedChecksums(): Promise<Map<string, string>> {
    const entries = await readdir(this.migrationsDirectory, { withFileTypes: true });
    const checksums = new Map<string, string>();
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const sql = await readFile(
        path.join(this.migrationsDirectory, entry.name, "migration.sql"),
      ).catch(() => undefined);
      if (sql !== undefined) {
        checksums.set(entry.name, createHash("sha256").update(sql).digest("hex"));
      }
    }
    return checksums;
  }

  private async readRecords(): Promise<MigrationRecord[]> {
    const [table] = await this.client.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('_prisma_migrations') IS NOT NULL AS exists`;
    if (!table?.exists) {
      return [];
    }
    return this.client.$queryRaw<MigrationRecord[]>`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at`;
  }
}
