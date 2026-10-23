import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);

/** A temporary Prisma migrations folder applied with the real `prisma migrate deploy`. */
export class PrismaMigrator {
  private constructor(readonly directory: string) {}

  static async create(): Promise<PrismaMigrator> {
    const directory = await mkdtemp(path.join(tmpdir(), "kushex-prisma-migrations-"));
    await writeFile(path.join(directory, "migration_lock.toml"), 'provider = "postgresql"\n');
    return new PrismaMigrator(directory);
  }

  async add(name: string, sql: string): Promise<void> {
    await mkdir(path.join(this.directory, name), { recursive: true });
    await writeFile(path.join(this.directory, name, "migration.sql"), sql);
  }

  /** Runs `prisma migrate deploy`; rejects with the CLI output when it fails. */
  async deploy(databaseUrl: string): Promise<void> {
    await run(
      path.join(packageRoot, "node_modules/.bin/prisma"),
      ["migrate", "deploy", "--config", "tests/support/prisma.test.config.ts"],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          KUSHEX_TEST_MIGRATIONS_DIR: this.directory,
        },
      },
    );
  }

  async remove(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
