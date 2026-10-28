import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AgentDto,
  AgentFileDto,
  AgentSummaryDto,
  PluginDto,
  PluginManifest,
} from "@kushex/contracts";
import { ConflictError } from "../../errors/ConflictError.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import type { AgentStore } from "../agents/application/AgentStore.js";
import { AgentName } from "../agents/domain/AgentName.js";
import { AgentFilePath } from "../agents/domain/AgentFilePath.js";
import { LocalAgentStore } from "../agents/infrastructure/LocalAgentStore.js";

type Registration = Readonly<{
  plugin: PluginManifest;
  agent: PluginManifest["agents"][number];
  directory: string;
}>;
type Discovered = { folder: string; dto: PluginDto; registrations: Registration[] };

/** Startup snapshot shared by browsing, editing and execution. No plugin code is evaluated. */
export class PluginCatalog implements AgentStore {
  readonly name = "plugin catalog";
  private discovered: Discovered[] = [];
  private readonly registrations = new Map<string, Registration>();
  private writes: Promise<unknown> = Promise.resolve();
  private readonly manifestSchema = z
    .object({
      id: z.string().regex(AgentName.pattern),
      name: z.string().min(1),
      version: z.string().min(1),
      apiVersion: z.literal(1),
      agents: z.array(
        z
          .object({
            id: z.string().regex(AgentName.pattern),
            name: z.string().min(1),
            description: z.string().optional(),
            directory: z.string().min(1),
            entry: z.string().refine((value) => AgentFilePath.isValid(value)),
          })
          .strict(),
      ),
    })
    .strict();

  constructor(
    private readonly localDirectory: string,
    private readonly pluginsDirectory?: string,
  ) {}

  async start(): Promise<void> {
    let migrationError: unknown;
    try {
      await this.migrateLocal();
    } catch (error) {
      migrationError = error;
    }
    const folders = [this.localDirectory];
    if (this.pluginsDirectory) {
      const entries = await readdir(this.pluginsDirectory, { withFileTypes: true }).catch(
        (error: unknown) => {
          if (this.isMissing(error)) return [];
          throw error;
        },
      );
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
        if (entry.isDirectory() || entry.isSymbolicLink())
          folders.push(path.join(this.pluginsDirectory, entry.name));
    }
    this.discovered = await Promise.all(folders.map((folder) => this.discover(folder)));
    if (migrationError && this.discovered[0])
      this.fail(this.discovered[0], `Local migration: ${this.message(migrationError)}`);
    const pluginIds = new Map<string, Discovered[]>();
    const agentIds = new Map<string, Discovered[]>();
    for (const plugin of this.discovered) {
      pluginIds.set(plugin.dto.id, [...(pluginIds.get(plugin.dto.id) ?? []), plugin]);
      for (const agent of plugin.dto.agents)
        agentIds.set(agent.id, [...(agentIds.get(agent.id) ?? []), plugin]);
    }
    for (const [label, ids] of [
      ["plugin", pluginIds],
      ["agent", agentIds],
    ] as const)
      for (const [id, owners] of ids)
        if (owners.length > 1)
          for (const owner of owners) this.fail(owner, `Duplicate ${label} ID "${id}".`);
    this.registrations.clear();
    for (const plugin of this.discovered)
      if (plugin.dto.errors.length === 0)
        for (const registration of plugin.registrations)
          this.registrations.set(registration.agent.id, registration);
  }

  async stop(): Promise<void> {
    await this.writes;
  }
  plugins(): readonly PluginDto[] {
    return this.discovered.map((plugin) => plugin.dto);
  }

  async list(): Promise<readonly AgentSummaryDto[]> {
    const entries = await Promise.all(
      [...this.registrations.keys()].map(async (id) => {
        const registration = this.require(id);
        const entry = await this.entry(new AgentName(id));
        const info = await lstat(entry.primaryFile);
        return { name: id, updatedAt: info.mtime.toISOString(), ...this.metadata(registration) };
      }),
    );
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async find(name: AgentName): Promise<AgentDto> {
    const registration = this.require(name.value);
    await this.verify(registration);
    return { ...(await this.store(registration).find(name)), ...this.metadata(registration) };
  }

  async entry(name: AgentName) {
    const registration = this.require(name.value);
    await this.verify(registration);
    return this.store(registration).entry(name);
  }

  create(name: AgentName, primarySource: string): Promise<AgentDto> {
    const operation = this.writes.then(async () => {
      if (
        this.discovered.some((plugin) => plugin.dto.agents.some((agent) => agent.id === name.value))
      )
        throw new ConflictError(`An agent named "${name}" already exists.`);
      const local = this.discovered.find((plugin) => plugin.folder === this.localDirectory);
      if (!local || local.dto.errors.length)
        throw new ConflictError("The local agents plugin is unavailable.");
      const manifest = this.manifestSchema.parse(
        JSON.parse(await readFile(this.manifestPath(this.localDirectory), "utf8")),
      );
      const folder = path.join(this.localDirectory, name.value);
      if (await lstat(folder).catch(() => null))
        throw new ConflictError(`Agent folder "${name}" already exists.`);
      await mkdir(folder); // Exclusive ownership: never remove a pre-existing folder on rollback.
      try {
        await writeFile(path.join(folder, "agent.ts"), primarySource, { flag: "wx" });
        const agent = {
          id: name.value,
          name: name.value,
          directory: name.value,
          entry: "agent.ts",
        };
        const updated: PluginManifest = { ...manifest, agents: [...manifest.agents, agent] };
        const registration = { plugin: updated, agent, directory: await realpath(folder) };
        const result = {
          ...(await this.store(registration).find(name)),
          ...this.metadata(registration),
        };
        await this.writeManifest(this.localDirectory, updated);
        local.dto = { ...local.dto, agents: updated.agents };
        local.registrations.push(registration);
        this.registrations.set(name.value, registration);
        return result;
      } catch (error) {
        await rm(folder, { recursive: true, force: true });
        throw error;
      }
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  async createFile(name: AgentName, file: AgentFilePath, content: string): Promise<AgentFileDto> {
    const registration = this.require(name.value);
    await this.verify(registration);
    return this.store(registration).createFile(name, file, content);
  }
  async updateFile(
    name: AgentName,
    file: AgentFilePath,
    content: string,
    revision: string,
  ): Promise<AgentFileDto> {
    const registration = this.require(name.value);
    await this.verify(registration);
    return this.store(registration).updateFile(name, file, content, revision);
  }
  async watch(name: AgentName, onChange: () => void, onError: (error: unknown) => void) {
    const registration = this.require(name.value);
    await this.verify(registration);
    return this.store(registration).watch(name, onChange, onError);
  }

  private async discover(folder: string): Promise<Discovered> {
    const result: Discovered = {
      folder,
      dto: {
        id: path.basename(folder),
        name: path.basename(folder),
        version: "",
        agents: [],
        errors: [],
      },
      registrations: [],
    };
    try {
      const raw: unknown = JSON.parse(await readFile(this.manifestPath(folder), "utf8"));
      const metadata = z
        .object({ id: z.string(), name: z.string(), version: z.string() })
        .safeParse(raw);
      if (metadata.success) result.dto = { ...result.dto, ...metadata.data };
      const manifest = this.manifestSchema.parse(raw);
      result.dto = { ...manifest, errors: [] };
      const root = await realpath(folder);
      for (const agent of manifest.agents) {
        try {
          const directory = await this.contained(root, agent.directory);
          if (!(await lstat(directory)).isDirectory())
            throw new Error("Agent directory is not a folder.");
          const entry = await this.contained(directory, agent.entry);
          if (!(await lstat(entry)).isFile()) throw new Error("Agent entry is not a regular file.");
          // The existing editor intentionally does not follow symlinks.
          if ((await lstat(path.join(directory, agent.entry))).isSymbolicLink())
            throw new Error("Agent entry must not be a symlink.");
          result.registrations.push({ plugin: manifest, agent, directory });
        } catch (error) {
          this.fail(result, `Agent "${agent.id}": ${this.message(error)}`);
        }
      }
    } catch (error) {
      this.fail(result, this.message(error));
    }
    return result;
  }

  private async contained(root: string, relative: string): Promise<string> {
    const target = path.resolve(root, relative);
    if (path.isAbsolute(relative) || relative.includes("\\") || !this.inside(root, target))
      throw new Error("Path escapes its source directory.");
    const resolved = await realpath(target);
    if (!this.inside(root, resolved)) throw new Error("Symlink escapes its source directory.");
    return resolved;
  }
  private inside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }
  private async verify(registration: Registration): Promise<void> {
    const owner = this.discovered.find((plugin) => plugin.registrations.includes(registration));
    if (!owner) throw new NotFoundError("Agent plugin is unavailable.");
    const directory = await this.contained(
      await realpath(owner.folder),
      registration.agent.directory,
    );
    if (directory !== registration.directory)
      throw new ConflictError("Agent source changed; restart Kushex.");
    await this.contained(directory, registration.agent.entry);
  }
  private store(registration: Registration): LocalAgentStore {
    // Retain serialization and revision checks across concurrent file requests.
    let store = this.stores.get(registration);
    if (!store) {
      store = new LocalAgentStore(
        this.localDirectory,
        {},
        { directory: registration.directory, entry: registration.agent.entry },
      );
      this.stores.set(registration, store);
    }
    return store;
  }
  private readonly stores = new WeakMap<Registration, LocalAgentStore>();
  private require(id: string): Registration {
    const registration = this.registrations.get(id);
    if (!registration)
      throw new NotFoundError(`Agent "${id}" is unavailable. Check its plugin installation.`);
    return registration;
  }
  private metadata(registration: Registration) {
    return {
      displayName: registration.agent.name,
      ...(registration.agent.description !== undefined
        ? { description: registration.agent.description }
        : {}),
      plugin: { id: registration.plugin.id, name: registration.plugin.name },
    };
  }
  private fail(plugin: Discovered, message: string): void {
    plugin.dto = { ...plugin.dto, errors: [...plugin.dto.errors, message] };
  }
  private manifestPath(folder: string): string {
    return path.join(folder, "kushex-plugin.json");
  }
  private message(error: unknown): string {
    // Filesystem errors contain absolute server paths; keep them out of public metadata.
    if (error && typeof error === "object" && "code" in error)
      return `Cannot access plugin source (${String(error.code)}).`;
    return error instanceof Error ? error.message : "Invalid plugin.";
  }
  private isMissing(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
  }
  private async migrateLocal(): Promise<void> {
    await mkdir(this.localDirectory, { recursive: true });
    const manifestFile = this.manifestPath(this.localDirectory);
    let manifest: PluginManifest;
    try {
      manifest = this.manifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8")));
    } catch (error) {
      if (!this.isMissing(error)) return; // Malformed local plugins are reported like external ones.
      manifest = {
        id: "local-agents",
        name: "Local Agents",
        version: "1.0.0",
        apiVersion: 1,
        agents: [],
      };
    }
    const agents = [...manifest.agents];
    for (const entry of await readdir(this.localDirectory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !AgentName.isValid(entry.name) ||
        agents.some((agent) => agent.id === entry.name)
      )
        continue;
      if (
        !(
          await lstat(path.join(this.localDirectory, entry.name, "agent.ts")).catch(() => null)
        )?.isFile()
      )
        continue;
      agents.push({ id: entry.name, name: entry.name, directory: entry.name, entry: "agent.ts" });
    }
    if (agents.length !== manifest.agents.length || !(await lstat(manifestFile).catch(() => null)))
      await this.writeManifest(this.localDirectory, { ...manifest, agents });
  }
  private async writeManifest(folder: string, manifest: PluginManifest): Promise<void> {
    const temporary = path.join(folder, `.kushex-plugin-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      await rename(temporary, this.manifestPath(folder));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
