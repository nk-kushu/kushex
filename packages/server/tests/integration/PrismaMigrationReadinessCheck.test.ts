import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PrismaMigrationReadinessCheck } from "../../src/infrastructure/database/PrismaMigrationReadinessCheck.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

const logger = pino({ level: "silent" });

describe("PrismaMigrationReadinessCheck", () => {
  let temporary: TemporaryDatabase;
  let database: PrismaDatabase;
  let migrator: PrismaMigrator;
  let check: PrismaMigrationReadinessCheck;

  beforeEach(async () => {
    temporary = await TemporaryDatabase.create();
    database = new PrismaDatabase(
      { url: temporary.url, maxConnections: 2, connectionTimeoutMs: 2000 },
      logger,
    );
    await database.start();
    migrator = await PrismaMigrator.create();
    check = new PrismaMigrationReadinessCheck(database.client, migrator.directory);
  });

  afterEach(async () => {
    await database.stop();
    await temporary.drop();
    await migrator.remove();
  });

  it("is ready for a fresh database when no migrations ship", async () => {
    expect(await check.check()).toEqual({ ready: true });
  });

  it("is not ready until prisma migrate deploy applies pending migrations", async () => {
    await migrator.add(
      "20260101000000_create_widgets",
      "CREATE TABLE widgets (id int PRIMARY KEY);",
    );
    expect(await check.check()).toEqual({
      ready: false,
      reason: "1 pending migration(s); run the migrate command.",
    });

    await migrator.deploy(temporary.url);
    expect(await check.check()).toEqual({ ready: true });
    await database.client.$executeRaw`INSERT INTO widgets (id) VALUES (1)`;

    await migrator.add("20260102000000_add_name", "ALTER TABLE widgets ADD COLUMN name text;");
    expect(await check.check()).toMatchObject({ ready: false });
    await migrator.deploy(temporary.url);
    expect(await check.check()).toEqual({ ready: true });
  });

  it("detects an applied migration that was edited", async () => {
    await migrator.add(
      "20260101000000_create_widgets",
      "CREATE TABLE widgets (id int PRIMARY KEY);",
    );
    await migrator.deploy(temporary.url);
    await writeFile(
      path.join(migrator.directory, "20260101000000_create_widgets", "migration.sql"),
      "CREATE TABLE widgets (id bigint PRIMARY KEY);",
    );
    expect(await check.check()).toEqual({
      ready: false,
      reason: "Migration 20260101000000_create_widgets was modified after it was applied.",
    });
  });

  it("reports a failed migration", async () => {
    await migrator.add("20260101000000_broken", "ALTER TABLE missing_table ADD COLUMN x int;");
    await expect(migrator.deploy(temporary.url)).rejects.toThrow();
    expect(await check.check()).toMatchObject({
      ready: false,
      reason: expect.stringMatching(/20260101000000_broken failed/),
    });
  });
});
