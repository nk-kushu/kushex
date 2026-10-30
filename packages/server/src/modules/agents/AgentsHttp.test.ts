import type { AgentDto, AgentFileDto, LibraryTypesDto, NodeTypesDto } from "@kushex/contracts";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import {
  AgentService,
  AgentsController,
  KushibotTypesReader,
  LocalAgentStore,
  NodeTypesReader,
} from "./public.js";

type TextFile = Extract<AgentFileDto, { kind: "text" }>;

let root: string;
let agentsDirectory: string;
let server: HttpServer;
let base: string;
const headers = { "content-type": "application/json" };

async function start(kushibotDirectory: string | null) {
  const logger = pino({ level: "silent" });
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [
      new AgentsController(
        new AgentService(
          new LocalAgentStore(agentsDirectory, { maxFileBytes: 4096, maxTotalBytes: 5000 }),
          new KushibotTypesReader(kushibotDirectory),
          new NodeTypesReader(),
        ),
      ),
    ],
    new LocalRequestGuard([]),
  );
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kushex-agents-"));
  // Test sources are installed on disk; the server never creates agents.
  agentsDirectory = path.join(root, "agents");
  await start(null);
});
afterEach(async () => {
  await server?.stop(new AbortController().signal);
  await rm(root, { recursive: true, force: true });
});

const create = async (name: string) => {
  await mkdir(path.join(agentsDirectory, name), { recursive: true });
  await writeFile(
    path.join(agentsDirectory, name, "agent.ts"),
    "export const chat = () => 'hello';\n",
  );
  return fetch(`${base}/agents/${name}`);
};
const find = async (name: string) =>
  (await (await fetch(`${base}/agents/${name}`)).json()) as AgentDto;
const createFile = (name: string, filePath: unknown) =>
  fetch(`${base}/agents/${name}/files`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path: filePath }),
  });
const save = (name: string, body: unknown) =>
  fetch(`${base}/agents/${name}/files`, { method: "PUT", headers, body: JSON.stringify(body) });
const text = (agent: AgentDto, filePath: string) =>
  agent.files.find((file) => file.path === filePath) as TextFile;

describe("agents HTTP API", () => {
  it("does not expose agent creation", async () => {
    const response = await fetch(`${base}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "reviewer" }),
    });
    expect(response.status).toBe(404);
    expect(await (await fetch(`${base}/agents`)).json()).toEqual({ entries: [], nextOffset: null });
  });

  it("returns every file in the folder and edits each one separately", async () => {
    await create("writer");
    const created = await createFile("writer", "prompts/review.md");
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      path: "prompts/review.md",
      kind: "text",
      content: "",
    });
    const before = await find("writer");
    expect(before.files.map((file) => file.path)).toEqual(["agent.ts", "prompts/review.md"]);

    const saved = await save("writer", {
      path: "prompts/review.md",
      content: "Review carefully.\n",
      baseRevision: text(before, "prompts/review.md").revision,
    });
    expect(saved.status).toBe(200);
    const after = await find("writer");
    expect(text(after, "prompts/review.md").content).toBe("Review carefully.\n");
    // Saving one file leaves the others' revisions alone.
    expect(text(after, "agent.ts").revision).toBe(text(before, "agent.ts").revision);
    expect(
      await readFile(path.join(agentsDirectory, "writer", "prompts", "review.md"), "utf8"),
    ).toBe("Review carefully.\n");
    expect(await readdir(path.join(agentsDirectory, "writer", "prompts"))).toEqual(["review.md"]);

    // A second editor still holding the first revision cannot overwrite the save.
    const stale = await save("writer", {
      path: "prompts/review.md",
      content: "lost",
      baseRevision: text(before, "prompts/review.md").revision,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "CONFLICT" });
    expect((await createFile("writer", "prompts/review.md")).status).toBe(409);
  });

  it("lists binary and oversized files without content and refuses to save them", async () => {
    await create("mixed");
    const folder = path.join(agentsDirectory, "mixed");
    await writeFile(path.join(folder, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    await writeFile(path.join(folder, "big.txt"), "x".repeat(4097));
    const agent = await find("mixed");
    expect(agent.files.find((file) => file.path === "logo.png")).toMatchObject({ kind: "binary" });
    expect(agent.files.find((file) => file.path === "big.txt")).toMatchObject({
      kind: "too-large",
    });
    expect(
      (await save("mixed", { path: "logo.png", content: "x", baseRevision: "a".repeat(64) }))
        .status,
    ).toBe(409);
    const revision = text(agent, "agent.ts").revision;
    expect(
      (await save("mixed", { path: "agent.ts", content: "x".repeat(4097), baseRevision: revision }))
        .status,
    ).toBe(413);
    // Past the per-agent content budget, further files are listed without content.
    await writeFile(path.join(folder, "extra.md"), "x".repeat(1000));
    await writeFile(path.join(folder, "notes.md"), "y".repeat(4096));
    expect((await find("mixed")).files.find((file) => file.path === "notes.md")).toMatchObject({
      kind: "too-large",
    });
  });

  it("rejects missing agents and unsafe paths", async () => {
    await create("one");
    expect((await fetch(`${base}/agents/missing`)).status).toBe(404);
    expect((await createFile("missing", "a.md")).status).toBe(404);
    const revision = text(await find("one"), "agent.ts").revision;
    expect(
      (await save("one", { path: "nope.ts", content: "", baseRevision: revision })).status,
    ).toBe(404);
    for (const filePath of [
      "../x.ts",
      "a/../b.ts",
      ".hidden",
      "a/.b",
      "/abs.ts",
      "a//b",
      "",
      "a\\b",
      "a/b/c/d/e/f/g/h/i.ts",
    ])
      expect((await createFile("one", filePath)).status).toBe(400);
    expect((await fetch(`${base}/agents/..%2Fescape`)).status).toBe(400);
    expect(
      (await save("one", { path: "agent.ts", content: "", baseRevision: "nope" })).status,
    ).toBe(400);
  });

  it("lists folders, including empty ones but not hidden ones", async () => {
    await create("foldered");
    const folder = path.join(agentsDirectory, "foldered");
    await mkdir(path.join(folder, "memory", "compression"), { recursive: true });
    await mkdir(path.join(folder, "workspace"));
    await mkdir(path.join(folder, ".cache"));
    expect((await find("foldered")).folders).toEqual(["memory", "memory/compression", "workspace"]);
  });

  it("never follows symlinks, for agent folders, subfolders or files", async () => {
    await mkdir(path.join(root, "outside"));
    await writeFile(path.join(root, "outside", "agent.ts"), "secret");
    await mkdir(path.join(agentsDirectory, "empty"), { recursive: true });
    await writeFile(path.join(agentsDirectory, "plain"), "not a folder");
    await symlink(path.join(root, "outside"), path.join(agentsDirectory, "linked-folder"));
    await mkdir(path.join(agentsDirectory, "linked-file"));
    await symlink(
      path.join(root, "outside", "agent.ts"),
      path.join(agentsDirectory, "linked-file", "agent.ts"),
    );
    expect(await (await fetch(`${base}/agents`)).json()).toEqual({ entries: [], nextOffset: null });
    for (const name of ["empty", "plain", "linked-folder", "linked-file"])
      expect((await fetch(`${base}/agents/${name}`)).status).toBe(404);
    await create("empty");

    // Links inside an agent folder are neither listed nor written through.
    const folder = path.join(agentsDirectory, "empty");
    await symlink(path.join(root, "outside"), path.join(folder, "lib"));
    await symlink(path.join(root, "outside", "agent.ts"), path.join(folder, "copy.ts"));
    expect((await find("empty")).files.map((file) => file.path)).toEqual(["agent.ts"]);
    expect((await find("empty")).folders).toEqual([]);
    expect((await createFile("empty", "lib/new.ts")).status).toBe(409);
    expect((await createFile("empty", "copy.ts")).status).toBe(409);
    expect(
      (await save("empty", { path: "copy.ts", content: "x", baseRevision: "a".repeat(64) })).status,
    ).toBe(404);
    expect(await readdir(path.join(root, "outside"))).toEqual(["agent.ts"]);
    expect(await readFile(path.join(root, "outside", "agent.ts"), "utf8")).toBe("secret");
  });

  it("serves kushibot declarations when a checkout is configured", async () => {
    expect(await (await fetch(`${base}/kushibot/types`)).json()).toEqual({
      packageName: "kushibot",
      version: null,
      files: [],
    });
    const kushibot = path.join(root, "kushibot");
    await mkdir(path.join(kushibot, "dist", "models"), { recursive: true });
    await writeFile(
      path.join(kushibot, "package.json"),
      JSON.stringify({ name: "kushibot", version: "1.2.3", types: "./dist/index.d.ts" }),
    );
    await writeFile(path.join(kushibot, "dist", "index.d.ts"), 'export * from "./models/a.js";');
    await writeFile(path.join(kushibot, "dist", "models", "a.d.ts"), "export type A = 1;");
    await writeFile(path.join(kushibot, "dist", "models", "a.js"), "export {};");
    await server.stop(new AbortController().signal);
    await start(kushibot);
    expect((await (await fetch(`${base}/kushibot/types`)).json()) as LibraryTypesDto).toEqual({
      packageName: "kushibot",
      version: "1.2.3",
      files: [
        { path: "index.d.ts", content: 'export * from "./models/a.js";' },
        { path: "models/a.d.ts", content: "export type A = 1;" },
      ],
    });
    await rm(path.join(kushibot, "dist"), { recursive: true });
    expect((await fetch(`${base}/kushibot/types`)).status).toBe(404);
  });

  it("serves Node declarations for the editor's TypeScript version", async () => {
    const { packages } = (await (await fetch(`${base}/node/types`)).json()) as NodeTypesDto;
    expect(packages.map((library) => library.packageName)).toEqual(["@types/node", "undici-types"]);
    const paths = packages[0]!.files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["index.d.ts", "child_process.d.ts"]));
    expect(paths.some((file) => file.startsWith("ts5."))).toBe(false);
    expect(packages[1]!.files.map((file) => file.path)).toContain("index.d.ts");
  });
});
