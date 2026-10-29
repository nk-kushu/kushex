import { createHash, randomUUID } from "node:crypto";
import { constants, watch } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { AgentDto, AgentFileDto, AgentSummaryDto } from "@kushex/contracts";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { PayloadTooLargeError } from "../../../errors/PayloadTooLargeError.js";
import type { AgentEntry, AgentStore } from "../application/AgentStore.js";
import { AgentFilePath } from "../domain/AgentFilePath.js";
import { AgentName, MAX_AGENT_SOURCE_BYTES } from "../domain/AgentName.js";

type Limits = Readonly<{
  /** Largest single file that is returned with its content and can be saved. */
  maxFileBytes: number;
  /** Text content returned for one agent; files past the budget come back as too large. */
  maxTotalBytes: number;
  /** Files listed for one agent; further files are left out. */
  maxFiles: number;
}>;

/**
 * Stores each agent as a folder `<directory>/<name>/` whose primary file, `agent.ts`,
 * exports the agent; any other files in the folder belong to the agent too. Symlinks
 * are never followed. Writes go through a temporary file and a rename, so a reader
 * never sees a half-written file. Writes are serialized within this process; the
 * server is the only intended writer.
 */
export class LocalAgentStore implements AgentStore {
  private readonly primaryFile: AgentFilePath;
  /** Bursts of file events, such as a tool rewriting several files, become one change. */
  private static readonly watchDelayMs = 150;
  private readonly limits: Limits;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: string,
    limits: Partial<Limits> = {},
    private readonly source?: Readonly<{ directory: string; entry: string }>,
  ) {
    this.primaryFile = new AgentFilePath(source?.entry ?? "agent.ts");
    this.limits = {
      maxFileBytes: MAX_AGENT_SOURCE_BYTES,
      maxTotalBytes: 4 * 1024 * 1024,
      maxFiles: 500,
      ...limits,
    };
  }

  async list(): Promise<readonly AgentSummaryDto[]> {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (this.isMissing(error)) return [];
      throw error;
    }
    const agents: AgentSummaryDto[] = [];
    // Dirent.isDirectory() is false for symlinks, so linked folders are not agents.
    for (const entry of entries) {
      if (!entry.isDirectory() || !AgentName.isValid(entry.name)) continue;
      const primary = await this.primaryInfo(new AgentName(entry.name));
      if (primary) agents.push({ name: entry.name, updatedAt: primary.mtime.toISOString() });
    }
    return agents.sort((a, b) => a.name.localeCompare(b.name));
  }

  async find(name: AgentName): Promise<AgentDto> {
    const primary = await this.primaryInfo(name);
    if (!primary) throw new NotFoundError(`Agent "${name}" not found.`);
    const files: AgentFileDto[] = [];
    let budget = this.limits.maxTotalBytes;
    for (const file of await this.walk(this.folderPath(name), [])) {
      const read = await this.read(name, file, budget);
      if (!read) continue;
      if (read.kind === "text") budget -= read.size;
      files.push(read);
    }
    return {
      name: name.value,
      primaryFile: this.primaryFile.value,
      updatedAt: primary.mtime.toISOString(),
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async entry(name: AgentName): Promise<AgentEntry> {
    await this.requireAgent(name);
    // Real paths, as the agent's module URLs show them when it runs.
    const directory = await realpath(this.folderPath(name));
    return {
      directory,
      primaryFile: path.join(directory, ...this.primaryFile.segments),
    };
  }

  createFile(name: AgentName, file: AgentFilePath, content: string): Promise<AgentFileDto> {
    return this.serialized(async () => {
      await this.requireAgent(name);
      let folder = this.folderPath(name);
      for (const segment of file.parents) {
        folder = path.join(folder, segment);
        await this.ensureFolder(folder, `${segment}/ in agents/${name}`);
      }
      if (await lstat(this.filePath(name, file)).catch(() => null))
        throw new ConflictError(`agents/${name}/${file} already exists.`);
      await this.write(name, file, content);
      return this.requireText(name, file);
    });
  }

  updateFile(
    name: AgentName,
    file: AgentFilePath,
    content: string,
    baseRevision: string,
  ): Promise<AgentFileDto> {
    return this.serialized(async () => {
      await this.requireAgent(name);
      const current = await this.requireText(name, file);
      if (current.revision !== baseRevision)
        throw new ConflictError(
          `agents/${name}/${file} changed since it was opened. Load the latest version and try again.`,
        );
      await this.write(name, file, content);
      return this.requireText(name, file);
    });
  }

  async watch(
    name: AgentName,
    onChange: () => void,
    onError: (error: unknown) => void,
  ): Promise<() => void> {
    await this.requireAgent(name);
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(this.folderPath(name), { recursive: true }, (_event, file) => {
      // Hidden names, such as the temporary files of a write, are not agent files.
      if (file && file.split(path.sep).some((segment) => segment.startsWith("."))) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, LocalAgentStore.watchDelayMs);
    });
    const close = () => {
      clearTimeout(timer);
      watcher.close();
    };
    watcher.on("error", (error) => {
      close();
      onError(error);
    });
    return close;
  }

  /** Paths of the regular files below `folder`, skipping links, hidden and unaddressable names. */
  private async walk(folder: string, parents: readonly string[]): Promise<AgentFilePath[]> {
    const files: AgentFilePath[] = [];
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= this.limits.maxFiles) break;
      if (!AgentFilePath.isValidSegment(entry.name)) continue;
      const segments = [...parents, entry.name];
      if (entry.isFile()) files.push(new AgentFilePath(segments.join("/")));
      else if (entry.isDirectory() && segments.length < AgentFilePath.maxDepth)
        files.push(...(await this.walk(path.join(folder, entry.name), segments)));
    }
    return files.slice(0, this.limits.maxFiles);
  }

  /** The file as stored, or null when it is missing, a link or not a regular file. */
  private async read(
    name: AgentName,
    file: AgentFilePath,
    budget = Number.POSITIVE_INFINITY,
  ): Promise<AgentFileDto | null> {
    if (!(await this.hasRealParents(name, file))) return null;
    let handle;
    try {
      // Nonblocking: special files such as FIFOs must not hang the request.
      handle = await open(
        this.filePath(name, file),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (this.isMissing(error) || this.code(error) === "ELOOP") return null;
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) return null;
      const base = { path: file.value, size: info.size, updatedAt: info.mtime.toISOString() };
      if (info.size > this.limits.maxFileBytes || info.size > budget)
        return { ...base, kind: "too-large" };
      const bytes = await handle.readFile();
      if (bytes.length > this.limits.maxFileBytes) return { ...base, kind: "too-large" };
      if (bytes.includes(0)) return { ...base, kind: "binary" };
      try {
        return {
          ...base,
          size: bytes.length,
          kind: "text",
          content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          revision: createHash("sha256").update(bytes).digest("hex"),
        };
      } catch {
        return { ...base, kind: "binary" };
      }
    } finally {
      await handle.close();
    }
  }

  private async requireText(
    name: AgentName,
    file: AgentFilePath,
  ): Promise<Extract<AgentFileDto, { kind: "text" }>> {
    const current = await this.read(name, file);
    if (!current) throw new NotFoundError(`agents/${name}/${file} not found.`);
    if (current.kind !== "text")
      throw new ConflictError(`agents/${name}/${file} is not an editable text file.`);
    return current;
  }

  private async requireAgent(name: AgentName): Promise<void> {
    if (!(await this.primaryInfo(name))) throw new NotFoundError(`Agent "${name}" not found.`);
  }

  /** The primary file's stats when the agent exists as a real folder with a regular primary file. */
  private async primaryInfo(name: AgentName) {
    if (!(await this.isRealFolder(this.folderPath(name)))) return null;
    const info = await lstat(this.filePath(name, this.primaryFile)).catch(() => null);
    return info?.isFile() ? info : null;
  }

  /** Creates `folder`, or accepts it when it already exists as a real folder. */
  private async ensureFolder(folder: string, label: string): Promise<void> {
    try {
      await mkdir(folder);
    } catch (error) {
      if (this.code(error) !== "EEXIST") throw error;
      if (!(await this.isRealFolder(folder)))
        throw new ConflictError(`${label} exists and is not a folder.`);
    }
  }

  private async hasRealParents(name: AgentName, file: AgentFilePath): Promise<boolean> {
    let folder = this.folderPath(name);
    if (!(await this.isRealFolder(folder))) return false;
    for (const segment of file.parents) {
      folder = path.join(folder, segment);
      if (!(await this.isRealFolder(folder))) return false;
    }
    return true;
  }

  private async write(name: AgentName, file: AgentFilePath, content: string): Promise<void> {
    const size = Buffer.byteLength(content, "utf8");
    if (size > this.limits.maxFileBytes)
      throw new PayloadTooLargeError(size, this.limits.maxFileBytes);
    const target = this.filePath(name, file);
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      if (["EACCES", "EPERM", "EROFS"].includes(String(this.code(error))))
        throw new ForbiddenError(
          "Agent source is not writable. Grant write access to its plugin folder to save changes.",
        );
      throw error;
    }
  }

  private async isRealFolder(folder: string): Promise<boolean> {
    const info = await lstat(folder).catch(() => null);
    return info?.isDirectory() ?? false;
  }

  private folderPath(name: AgentName): string {
    return this.source?.directory ?? path.join(this.directory, name.value);
  }

  private filePath(name: AgentName, file: AgentFilePath): string {
    return path.join(this.folderPath(name), ...file.segments);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation, operation);
    this.writes = result.catch(() => undefined);
    return result;
  }

  private code(error: unknown): unknown {
    return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  }

  private isMissing(error: unknown): boolean {
    return this.code(error) === "ENOENT";
  }
}
