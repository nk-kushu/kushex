import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PrismaProjectRepository } from "../../src/modules/projects/public.js";
import { PrismaWorkspaceRepository } from "../../src/modules/workspaces/public.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  await migrator.add(
    "20261023000000_projects_and_workspaces",
    await readFile(
      fileURLToPath(
        new URL(
          "../../prisma/migrations/20261023000000_projects_and_workspaces/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  await migrator.deploy(temporary.url);
  database = new PrismaDatabase(
    { url: temporary.url, maxConnections: 2, connectionTimeoutMs: 1000 },
    pino({ level: "silent" }),
  );
  await database.start();
});
afterEach(async () => {
  await database?.stop();
  await temporary?.drop();
  await migrator?.remove();
});

describe("project persistence", () => {
  it("atomically persists separate project and workspace rows in kushex", async () => {
    const projects = new PrismaProjectRepository(database.client);
    const project = await projects.create("local-operator", {
      name: "Example",
      description: "Durable data",
      path: "checkout",
    });
    expect(await projects.find("local-operator", project.id)).toEqual(project);
    expect(await projects.list("local-operator", 0)).toEqual({
      entries: [project],
      nextOffset: null,
    });
    const workspaces = new PrismaWorkspaceRepository(database.client);
    expect(await workspaces.findForProject(project.id, "local-operator")).toMatchObject({
      id: project.workspace.id,
      projectId: project.id,
      path: "checkout",
    });
    expect(await workspaces.findForProject(project.id, "other-actor")).toBeNull();
    expect(await projects.find("other-actor", project.id)).toBeNull();
    await expect(
      database.client.workspace.create({ data: { projectId: project.id, path: "second" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    const [schemas] = await database.client.$queryRaw<
      { project: string | null; workspace: string | null }[]
    >`SELECT to_regclass('kushex."Project"')::text AS project, to_regclass('kushex."Workspace"')::text AS workspace`;
    expect(schemas?.project).toBeTruthy();
    expect(schemas?.workspace).toBeTruthy();
  });
  it("rolls back the project if nested workspace insertion fails", async () => {
    const projects = new PrismaProjectRepository(database.client);
    await expect(
      projects.create("local-operator", { name: "Must roll back", path: "x".repeat(4097) }),
    ).rejects.toThrow();
    expect(await database.client.project.count()).toBe(0);
    expect(await database.client.workspace.count()).toBe(0);
  });
});
