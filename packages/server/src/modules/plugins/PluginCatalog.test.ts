import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PluginCatalog } from "./PluginCatalog.js";
import { AgentName } from "../agents/domain/AgentName.js";
import { AgentFilePath } from "../agents/domain/AgentFilePath.js";
import type { PluginManifest } from "@kushex/contracts";

let root: string;
let local: string;
let plugins: string;
let catalog: PluginCatalog;
const name = (value: string) => new AgentName(value);
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kushex-plugins-"));
  local = path.join(root, "agents");
  plugins = path.join(root, "plugins");
  catalog = new PluginCatalog(plugins);
  await mkdir(path.join(local, "coding"), { recursive: true });
  await writeFile(path.join(local, "coding/agent.ts"), "export const chat = () => 'legacy';");
  const coding = path.join(plugins, "coding");
  await mkdir(coding, { recursive: true });
  await writeFile(path.join(coding, "agent.ts"), "export const chat = () => 'coding';");
  await save(coding, {
    id: "coding",
    name: "Coding Agent",
    version: "1.0.0",
    apiVersion: 1,
    agents: [{ id: "coding", name: "Coding", directory: ".", entry: "agent.ts" }],
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plugin(id: string, ids = ["echo", "review"]) {
  const folder = path.join(plugins, id);
  const manifest: PluginManifest = {
    id,
    name: `Plugin ${id}`,
    version: "1.0.0",
    apiVersion: 1,
    agents: ids.map((id) => ({
      id,
      name: `Agent ${id}`,
      description: "A test agent",
      directory: `sources/${id}-source`,
      entry: "main.ts",
    })),
  };
  for (const agent of manifest.agents) {
    await mkdir(path.join(folder, agent.directory, "prompts"), { recursive: true });
    await writeFile(
      path.join(folder, agent.directory, agent.entry),
      "export const chat = () => 'hello';",
    );
    await writeFile(
      path.join(folder, agent.directory, "prompts/prompt.ts"),
      "export default 'prompt';",
    );
  }
  await save(folder, manifest);
  return { folder, manifest };
}
async function save(folder: string, manifest: unknown) {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "kushex-plugin.json"), JSON.stringify(manifest));
}

it("resolves explicit plugin sources, custom entries and revision checked saves", async () => {
  const { folder } = await plugin("development");
  await catalog.start();
  expect(catalog.plugins()).toHaveLength(2);
  expect((await catalog.list()).map((agent) => agent.name)).toEqual(["coding", "echo", "review"]);
  const agent = await catalog.find(name("echo"));
  expect(agent).toMatchObject({
    primaryFile: "main.ts",
    displayName: "Agent echo",
    plugin: { id: "development" },
  });
  expect(agent.files.map((file) => file.path)).toEqual(["main.ts", "prompts/prompt.ts"]);
  const file = agent.files[0]!;
  if (file.kind !== "text") throw new Error("Expected text");
  await catalog.updateFile(name("echo"), new AgentFilePath("main.ts"), "saved", file.revision);
  await expect(
    catalog.updateFile(name("echo"), new AgentFilePath("main.ts"), "stale", file.revision),
  ).rejects.toThrow(/changed/);
  expect(await readFile(path.join(folder, "sources/echo-source/main.ts"), "utf8")).toBe("saved");
  expect((await catalog.entry(name("echo"))).primaryFile).toBe(
    path.join(
      await import("node:fs/promises").then((fs) => fs.realpath(folder)),
      "sources/echo-source/main.ts",
    ),
  );
  expect(JSON.stringify(catalog.plugins())).not.toContain(root);
  expect((await catalog.entry(name("coding"))).primaryFile).toContain("coding/agent.ts");
});

it("does not register legacy folders or create a local plugin manifest", async () => {
  await catalog.start();
  expect(catalog.plugins().map((plugin) => plugin.id)).toEqual(["coding"]);
  await expect(readFile(path.join(local, "kushex-plugin.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(path.join(local, "coding/agent.ts"), "utf8")).toContain("legacy");
});

it("does not rewrite manifests or automatically add unlisted agents", async () => {
  const folder = path.join(plugins, "coding");
  const before = await readFile(path.join(folder, "kushex-plugin.json"), "utf8");
  await mkdir(path.join(folder, "unlisted"));
  await writeFile(path.join(folder, "unlisted/agent.ts"), "export const chat = () => 'unlisted';");
  await catalog.start();
  expect((await catalog.list()).map((agent) => agent.name)).toEqual(["coding"]);
  expect(await readFile(path.join(folder, "kushex-plugin.json"), "utf8")).toBe(before);
});

it("marks every conflicting plugin unavailable regardless of discovery order", async () => {
  await plugin("first");
  await plugin("second", ["echo", "other"]);
  await catalog.start();
  expect((await catalog.list()).map((agent) => agent.name)).toEqual(["coding"]);
  for (const entry of catalog.plugins().filter((entry) => entry.id !== "coding"))
    expect(entry.errors.join(" ")).toMatch(/Duplicate agent ID "echo"/);
});

it("rejects duplicate plugin IDs and duplicate IDs within one manifest", async () => {
  const first = await plugin("first", ["one"]);
  const second = await plugin("second", ["two"]);
  await save(second.folder, { ...second.manifest, id: first.manifest.id });
  await plugin("third", ["same", "same"]);
  await catalog.start();
  expect((await catalog.list()).map((agent) => agent.name)).toEqual(["coding"]);
  expect(catalog.plugins().filter((entry) => entry.errors.length)).toHaveLength(3);
});

it.each(["missing", "escape", "symlink", "entry-symlink", "version", "json"])(
  "rejects %s plugins atomically while retaining valid plugins",
  async (kind) => {
    const broken = await plugin("broken");
    await plugin("good", ["good"]);
    const agent = broken.manifest.agents[0]!;
    if (kind === "missing") await rm(path.join(broken.folder, agent.directory, agent.entry));
    if (kind === "escape")
      await save(broken.folder, {
        ...broken.manifest,
        agents: [{ ...agent, directory: "../../agents/coding" }],
      });
    if (kind === "symlink") {
      await symlink(path.join(local, "coding"), path.join(broken.folder, "outside"));
      await save(broken.folder, {
        ...broken.manifest,
        agents: [{ ...agent, directory: "outside", entry: "agent.ts" }],
      });
    }
    if (kind === "entry-symlink") {
      const file = path.join(broken.folder, agent.directory, agent.entry);
      await rm(file);
      await symlink(path.join(local, "coding/agent.ts"), file);
    }
    if (kind === "version") await save(broken.folder, { ...broken.manifest, apiVersion: 2 });
    if (kind === "json") await writeFile(path.join(broken.folder, "kushex-plugin.json"), "{");
    await catalog.start();
    expect((await catalog.list()).map((agent) => agent.name)).toEqual(["coding", "good"]);
    expect(catalog.plugins().find((entry) => entry.id === "broken")?.errors.length).toBeGreaterThan(
      0,
    );
  },
);

it("rejects removed agents after restart and restores the same IDs on reinstall", async () => {
  const external = await plugin("external");
  await catalog.start();
  await rm(external.folder, { recursive: true });
  const restarted = new PluginCatalog(plugins);
  await restarted.start();
  await expect(restarted.entry(name("echo"))).rejects.toThrow(/unavailable/);
  await plugin("external");
  await restarted.start();
  expect((await restarted.find(name("echo"))).plugin?.id).toBe("external");
});

it("discovers the shipped coding package with the stable coding agent ID", async () => {
  const directory = fileURLToPath(new URL("../../../../../plugins", import.meta.url));
  const shipped = new PluginCatalog(directory);
  await shipped.start();
  expect(shipped.plugins()).toContainEqual(
    expect.objectContaining({ id: "coding", name: "Coding Agent", errors: [] }),
  );
  expect((await shipped.entry(name("coding"))).primaryFile).toBe(
    await import("node:fs/promises").then((fs) =>
      fs.realpath(path.join(directory, "coding/agent.ts")),
    ),
  );
  expect((await shipped.find(name("coding"))).plugin).toEqual({
    id: "coding",
    name: "Coding Agent",
  });
});

it("does not create a missing plugins directory", async () => {
  const directory = path.join(root, "not-installed");
  const missing = new PluginCatalog(directory);
  await missing.start();
  expect(missing.plugins()).toEqual([]);
  await expect(readFile(path.join(directory, "kushex-plugin.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
