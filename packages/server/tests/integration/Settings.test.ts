import { readFile } from "node:fs/promises";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PrismaSettingsRepository } from "../../src/modules/settings/public.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const migration of [
    "20261023000000_projects_and_workspaces",
    "20261025000000_user_settings",
    "20261025120000_user_settings_splitter_sizes",
  ]) {
    await migrator.add(
      migration,
      await readFile(
        new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
  }
  await migrator.deploy(temporary.url);
  database = new PrismaDatabase(
    { url: temporary.url, maxConnections: 4, connectionTimeoutMs: 1000 },
    pino({ level: "silent" }),
  );
  await database.start();
});
afterEach(async () => {
  await database?.stop();
  await temporary?.drop();
  await migrator?.remove();
});

describe("user settings persistence", () => {
  it("preserves concurrent first writes, isolates users, and survives reconnecting", async () => {
    const repository = new PrismaSettingsRepository(database.client);
    expect(await repository.find("alice")).toBeNull();
    await Promise.all([
      repository.update("alice", { colorMode: "dark" }),
      repository.update("alice", { density: "compact" }),
    ]);
    expect(await repository.find("alice")).toEqual({ colorMode: "dark", density: "compact", splitterSizes: {} });
    expect(await repository.find("bob")).toBeNull();
    expect(await repository.update("bob", { colorMode: "light" })).toEqual({
      colorMode: "light",
      density: "comfortable",
      splitterSizes: {},
    });
    expect(await repository.update("alice", { colorMode: "system" })).toEqual({
      colorMode: "system",
      density: "compact",
      splitterSizes: {},
    });
    await database.stop();
    database = new PrismaDatabase(
      { url: temporary.url, maxConnections: 2, connectionTimeoutMs: 1000 },
      pino({ level: "silent" }),
    );
    await database.start();
    expect(await new PrismaSettingsRepository(database.client).find("alice")).toEqual({
      colorMode: "system",
      density: "compact",
      splitterSizes: {},
    });
    expect(await database.client.userSettings.count()).toBe(2);
    expect(
      (await database.client.userSettings.findUniqueOrThrow({ where: { actorId: "alice" } }))
        .updatedAt,
    ).toBeInstanceOf(Date);
  });
  it("merges splitter sizes by id, including concurrent first writes", async () => {
    const repository = new PrismaSettingsRepository(database.client);
    await Promise.all([
      repository.update("alice", { splitterSizes: { files: [0.7, 0.3] } }),
      repository.update("alice", { splitterSizes: { notes: [0.5, 0.5] } }),
      repository.update("alice", { colorMode: "dark" }),
    ]);
    expect(
      await repository.update("alice", {
        density: "compact",
        splitterSizes: { files: [0.6, 0.4] },
      }),
    ).toEqual({
      colorMode: "dark",
      density: "compact",
      splitterSizes: { files: [0.6, 0.4], notes: [0.5, 0.5] },
    });
  });
});
