import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceEvidence } from "kushibot";

/** Captures CLI additions/deletions as well as edits, and projects restricted tasks. */
export class CliWorkspace {
  private initial = new Map<string, string>();
  private readonly reviewable = new Set<string>();
  constructor(
    private readonly directory: string,
    private readonly files: readonly string[],
  ) {}

  async initialize(evidence: WorkspaceEvidence): Promise<void> {
    this.initial = await this.snapshot();
    for (const file of this.initial.keys()) {
      try {
        await this.read(file);
        this.reviewable.add(file);
      } catch {
        /* Unchanged binary/large/symlink files are fingerprinted, not published. */
      }
    }
    await evidence.initialize([...new Set([...this.reviewable, ...this.files])].sort());
  }

  async refresh(evidence: WorkspaceEvidence): Promise<void> {
    const current = await this.snapshot();
    let changed = 0;
    for (const file of new Set([...current.keys(), ...this.initial.keys()])) {
      if (current.get(file) === this.initial.get(file)) continue;
      if (++changed > 16) throw new Error("CLI changes exceed the 16-file review limit.");
      if (this.initial.has(file) && !this.reviewable.has(file))
        throw new Error(`CLI modified a file unsupported by change review: ${file}`);
      await this.read(file);
      if (!this.initial.has(file)) evidence.track(file, null);
    }
  }

  async read(file: string): Promise<string | null> {
    const location = await this.location(file);
    try {
      const entry = await lstat(location);
      if (!entry.isFile() || entry.nlink !== 1 || entry.size > 64 * 1024)
        throw new Error(`Cannot review non-regular, hard-linked, or oversized file: ${file}`);
      const handle = await open(
        location,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024)
          throw new Error(`Cannot review non-regular, hard-linked, or oversized file: ${file}`);
        const bytes = await handle.readFile();
        if (bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes))
          throw new Error(`Cannot review binary file: ${file}`);
        return bytes.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async execute<T>(readOnly: boolean, work: (directory: string) => Promise<T>): Promise<T> {
    if (this.files.length === 0) return work(this.directory);
    const projection = await mkdtemp(path.join(tmpdir(), "kushex-cli-scope-"));
    try {
      for (const file of this.files) {
        if ((await this.read(file)) === null) continue;
        await mkdir(path.dirname(path.join(projection, file)), { recursive: true });
        await copyFile(await this.location(file), path.join(projection, file));
      }
      const result = await work(projection);
      if (!readOnly) {
        const projected = new CliWorkspace(projection, []);
        const contents = await projected.snapshot();
        if ([...contents.keys()].some((file) => !this.files.includes(file)))
          throw new Error("CLI created files outside the task allowlist; changes were discarded.");
        // Validate every result before copying any changes back.
        for (const file of this.files) await projected.read(file);
        for (const file of this.files) {
          const destination = await this.location(file);
          if ((await projected.read(file)) === null) {
            try {
              await unlink(destination);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          } else {
            await mkdir(path.dirname(destination), { recursive: true });
            await copyFile(path.join(projection, file), destination);
          }
        }
      }
      return result;
    } finally {
      await rm(projection, { recursive: true, force: true });
    }
  }

  private async snapshot(): Promise<Map<string, string>> {
    const contents = new Map<string, string>();
    if (this.files.length) {
      for (const file of this.files) {
        const content = await this.read(file);
        if (content !== null) contents.set(file, content);
      }
    } else {
      await this.walk("", contents);
    }
    return contents;
  }

  private async walk(relative: string, contents: Map<string, string>): Promise<void> {
    const entries = await readdir(path.join(this.directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || (relative === "" && entry.name === "node_modules")) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await this.walk(file, contents);
      else {
        contents.set(file, await this.fingerprint(file));
        if (contents.size > 10_000) throw new Error("CLI workspace exceeds 10,000 files.");
      }
    }
  }

  private async fingerprint(file: string): Promise<string> {
    const location = path.join(this.directory, file);
    const stat = await lstat(location);
    if (stat.isSymbolicLink()) return `symlink:${await readlink(location)}`;
    if (!stat.isFile() || stat.nlink !== 1)
      return `unsupported:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(64 * 1024);
      let count: number;
      do {
        ({ bytesRead: count } = await handle.read(buffer));
        hash.update(buffer.subarray(0, count));
      } while (count > 0);
      return hash.digest("hex");
    } finally {
      await handle.close();
    }
  }

  private async location(file: string): Promise<string> {
    if (
      !/^[A-Za-z0-9_.@/-]+$/.test(file) ||
      file.length > 256 ||
      path.isAbsolute(file) ||
      file.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") ||
      (this.files.length > 0 && !this.files.includes(file))
    )
      throw new Error("Path is outside the task file allowlist.");
    const root = await realpath(this.directory);
    let current = root;
    for (const part of file.split("/")) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error(`Symlink is outside CLI review scope: ${file}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return current;
  }
}
