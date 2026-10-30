import { readFile } from "node:fs/promises";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../src/errors/ConflictError.js";
import { NotFoundError } from "../../src/errors/NotFoundError.js";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { NoteService, PrismaNoteRepository } from "../../src/modules/notes/public.js";
import type { RequestContext } from "../../src/shared/application/RequestContext.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const migration of ["20261029120000_notes"]) {
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

const context = (actorId: string): RequestContext =>
  ({ requestId: "test", actor: { id: actorId } });

describe("notes", () => {
  it("titles notes by their first line and lists pinned notes first", async () => {
    const notes = new NoteService(new PrismaNoteRepository(database.client));
    const operator = context("operator");
    const empty = await notes.create(operator, "");
    expect(empty).toMatchObject({ title: "Untitled", content: "", pinned: false, revision: 1 });
    const runtime = await notes.create(operator, "\n## FrameworkRuntime\n\nOrders startup.");
    expect(runtime.title).toBe("FrameworkRuntime");
    await notes.update(operator, empty.id, { pinned: true });

    expect((await notes.list(operator, null)).map((note) => note.title)).toEqual([
      "Untitled",
      "FrameworkRuntime",
    ]);
    // Search matches content as well as titles, ignoring case.
    expect((await notes.list(operator, "startup")).map((note) => note.id)).toEqual([runtime.id]);
    // Notes belong to their actor.
    expect(await notes.list(context("other"), null)).toEqual([]);
    await expect(notes.find(context("other"), runtime.id)).rejects.toThrow(NotFoundError);
  });

  it("saves content only from the current revision", async () => {
    const notes = new NoteService(new PrismaNoteRepository(database.client));
    const operator = context("operator");
    const note = await notes.create(operator, "# Workflows");
    const saves = await Promise.allSettled([
      notes.update(operator, note.id, { content: "# Workflows\n\none", baseRevision: 1 }),
      notes.update(operator, note.id, { content: "# Workflows\n\ntwo", baseRevision: 1 }),
    ]);
    expect(saves.filter((save) => save.status === "fulfilled")).toHaveLength(1);
    const rejected = saves.find((save) => save.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ConflictError);

    const saved = await notes.update(operator, note.id, {
      content: "# Executors\n\nthree",
      baseRevision: 2,
      pinned: true,
    });
    expect(saved).toMatchObject({ title: "Executors", revision: 3, pinned: true });

    await notes.delete(operator, note.id);
    await expect(notes.delete(operator, note.id)).rejects.toThrow(NotFoundError);
    await expect(
      notes.update(operator, note.id, { content: "gone", baseRevision: 3 }),
    ).rejects.toThrow(NotFoundError);
  });
});
