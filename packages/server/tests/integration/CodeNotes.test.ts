import { readFile } from "node:fs/promises";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PrismaCodeNotesRepository } from "../../src/modules/agents/public.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const migration of ["20261028120000_agent_code_notes"]) {
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

describe("code notes persistence", () => {
  it("keeps one markdown document per agent and rejects saves from a stale revision", async () => {
    const repository = new PrismaCodeNotesRepository(database.client);
    expect(await repository.find("coding")).toBeNull();
    // Of two concurrent first saves, one wins.
    const first = await Promise.all([
      repository.save("coding", "# Code notes\n\none", 0),
      repository.save("coding", "# Code notes\n\ntwo", 0),
    ]);
    expect(first.filter(Boolean)).toHaveLength(1);
    const stored = (await repository.find("coding"))!;
    expect(stored.revision).toBe(1);

    expect(await repository.save("coding", "# Code notes\n\nthree", 1)).toEqual({
      content: "# Code notes\n\nthree",
      revision: 2,
    });
    expect(await repository.save("coding", "stale", 1)).toBeNull();
    expect(await repository.save("coding", "stale", 0)).toBeNull();
    expect(await repository.find("coding")).toEqual({ content: "# Code notes\n\nthree", revision: 2 });
    expect(await repository.find("planner")).toBeNull();
  });
});
