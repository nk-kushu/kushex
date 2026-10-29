import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pino } from "pino";
import { PluginCatalog } from "./PluginCatalog.js";
import { PluginsController } from "./PluginsController.js";
import { AgentService, AgentsController, KushibotTypesReader } from "../agents/public.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";

let root: string;
let server: HttpServer;
afterEach(async () => {
  await server?.stop(new AbortController().signal);
  if (root) await rm(root, { recursive: true, force: true });
});
it("serves plugin metadata and source APIs without exposing resolved server paths", async () => {
  root = await mkdtemp(path.join(tmpdir(), "kushex-plugin-http-"));
  const external = path.join(root, "plugins/example");
  await mkdir(path.join(external, "src"), { recursive: true });
  await writeFile(path.join(external, "src/main.ts"), "export const chat = () => 'hello';");
  await writeFile(
    path.join(external, "kushex-plugin.json"),
    JSON.stringify({
      id: "example",
      name: "Example",
      version: "1.0.0",
      apiVersion: 1,
      agents: [{ id: "echo", name: "Echo", directory: "src", entry: "main.ts" }],
    }),
  );
  const catalog = new PluginCatalog(path.join(root, "plugins"));
  await catalog.start();
  const logger = pino({ level: "silent" });
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [
      new PluginsController(catalog),
      new AgentsController(new AgentService(catalog, new KushibotTypesReader(null))),
    ],
    new LocalRequestGuard([]),
  );
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  const creation = await fetch(`${base}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "new-agent" }),
  });
  expect(creation.status).toBe(404);
  const plugins = await (await fetch(`${base}/plugins`)).text();
  expect(plugins).toContain("Example");
  expect(plugins).not.toContain(root);
  expect(await (await fetch(`${base}/plugins/example`)).json()).toMatchObject({
    id: "example",
    errors: [],
  });
  expect((await fetch(`${base}/plugins/missing`)).status).toBe(404);
  expect(await (await fetch(`${base}/agents`)).json()).toMatchObject({
    entries: [{ name: "echo", plugin: { id: "example" } }],
  });
  const agent = (await (await fetch(`${base}/agents/echo`)).json()) as {
    files: { path: string; revision: string }[];
  };
  expect(agent.files[0]!.path).toBe("main.ts");
  const saved = await fetch(`${base}/agents/echo/files`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "main.ts",
      content: "saved",
      baseRevision: agent.files[0]!.revision,
    }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ content: "saved" });
});
