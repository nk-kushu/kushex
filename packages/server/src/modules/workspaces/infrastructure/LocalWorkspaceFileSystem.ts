import { constants } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { DirectoryEntryDto, DirectoryPageDto, FileContentDto } from "@kushex/contracts";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { PayloadTooLargeError } from "../../../errors/PayloadTooLargeError.js";
import type { WorkspaceFileSystem } from "../application/WorkspaceFileSystem.js";
import type { WorkspacePathResolver } from "./WorkspacePathResolver.js";

export class LocalWorkspaceFileSystem implements WorkspaceFileSystem {
  constructor(
    private readonly resolver: WorkspacePathResolver,
    private readonly maxFileBytes = 1_048_576,
    private readonly pageSize = 500,
  ) {}

  locations(offset: number): Promise<DirectoryPageDto> {
    return this.guarded(() => this.page(this.rootDirectories(), offset));
  }

  async validateLocation(relative: string): Promise<void> {
    await this.guarded(async () => {
      if (!relative.split("/").some((part, index) => index > 0 && part !== ""))
        throw new ForbiddenError("Choose a directory inside a workspace root.");
      const location = await this.resolver.resolve(relative);
      if (!(await stat(location.absolute)).isDirectory())
        throw new NotFoundError("Workspace directory not found.");
    });
  }

  tree(workspace: string, relative: string, offset: number): Promise<DirectoryPageDto> {
    return this.guarded(() => this.page(this.entries(workspace, relative, false), offset));
  }

  async file(workspace: string, relative: string): Promise<FileContentDto> {
    return this.guarded(async () => {
      const location = await this.resolver.resolve(workspace, relative);
      // Nonblocking open prevents special files such as FIFOs from hanging a request.
      const handle = await open(
        location.absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new NotFoundError("Regular file not found.");
        const verified = await this.resolver.resolve(workspace, relative);
        const current = await stat(verified.absolute);
        if (
          verified.absolute !== location.absolute ||
          current.ino !== info.ino ||
          current.dev !== info.dev
        )
          throw new ForbiddenError("File changed while opening it. Refresh and try again.");
        if (info.size > this.maxFileBytes)
          throw new PayloadTooLargeError(info.size, this.maxFileBytes);
        // Also bound actual reads when a file grows after fstat.
        const buffer = Buffer.alloc(this.maxFileBytes + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
          if (result.bytesRead === 0) break;
          bytes += result.bytesRead;
        }
        if (bytes > this.maxFileBytes) throw new PayloadTooLargeError(bytes, this.maxFileBytes);
        const data = buffer.subarray(0, bytes);
        const base = { path: relative, size: bytes };
        if (data.includes(0)) return { ...base, kind: "binary" };
        try {
          return {
            ...base,
            kind: "text",
            content: new TextDecoder("utf-8", { fatal: true }).decode(data),
          };
        } catch {
          return { ...base, kind: "binary" };
        }
      } finally {
        await handle.close();
      }
    });
  }

  /** Immediate subdirectories of every root, as root-prefixed workspace paths. */
  private async *rootDirectories(): AsyncGenerator<DirectoryEntryDto> {
    for (const root of this.resolver.rootNames())
      for await (const entry of this.entries(root, "", true))
        yield { ...entry, path: path.posix.join(root, entry.path) };
  }

  private async *entries(
    workspace: string,
    relative: string,
    directoriesOnly: boolean,
  ): AsyncGenerator<DirectoryEntryDto> {
    const location = await this.resolver.resolve(workspace, relative);
    const directory = await opendir(location.absolute);
    for await (const entry of directory) {
      if (this.resolver.isIgnored(entry.name)) continue;
      const entryPath = path.posix.join(relative, entry.name);
      let kind: "directory" | "file";
      if (entry.isDirectory()) kind = "directory";
      else if (entry.isFile()) kind = "file";
      else if (entry.isSymbolicLink()) {
        try {
          const target = await this.resolver.resolve(workspace, entryPath);
          const info = await stat(target.absolute);
          if (info.isDirectory()) kind = "directory";
          else if (info.isFile()) kind = "file";
          else continue;
        } catch (error) {
          if (error instanceof ForbiddenError || error instanceof NotFoundError) continue;
          throw error;
        }
      } else continue;
      if (directoriesOnly && kind !== "directory") continue;
      yield { name: entry.name, path: entryPath, kind };
    }
  }

  private async page(
    source: AsyncIterable<DirectoryEntryDto>,
    offset: number,
  ): Promise<DirectoryPageDto> {
    const entries: DirectoryEntryDto[] = [];
    let seen = 0;
    for await (const entry of source) {
      if (seen++ < offset) continue;
      if (entries.length === this.pageSize) return { entries, nextOffset: offset + entries.length };
      entries.push(entry);
    }
    return { entries, nextOffset: null };
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (["ENOENT", "ENOTDIR", "EISDIR", "ENXIO"].includes(String(error.code)))
          throw new NotFoundError("Workspace path not found or no longer available.");
        if (["EACCES", "EPERM", "ELOOP"].includes(String(error.code)))
          throw new ForbiddenError("Workspace path is not accessible.");
      }
      throw error;
    }
  }
}
