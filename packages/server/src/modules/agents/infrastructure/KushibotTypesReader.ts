import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LibraryTypesDto } from "@kushex/contracts";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { LibraryTypesSource } from "../application/LibraryTypesSource.js";

/**
 * Reads the built `.d.ts` files of a kushibot checkout. Without a configured
 * checkout the editor still works, only without kushibot type checking.
 */
export class KushibotTypesReader implements LibraryTypesSource {
  constructor(
    /** Absolute kushibot package directory (the one holding its package.json), or null. */
    private readonly packageRoot: string | null,
    private readonly maxTotalBytes = 16 * 1024 * 1024,
  ) {}

  async read(): Promise<LibraryTypesDto> {
    if (!this.packageRoot) return { packageName: "kushibot", version: null, files: [] };
    const manifest = await this.manifest(this.packageRoot);
    const declarationRoot = path.dirname(path.resolve(this.packageRoot, manifest.types));
    let entries;
    try {
      entries = await readdir(declarationRoot, { recursive: true, withFileTypes: true });
    } catch {
      throw this.notBuilt();
    }
    const files: { path: string; content: string }[] = [];
    let total = 0;
    // Dirent.isFile() is false for symlinks, so links out of the package are skipped.
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const content = await readFile(absolute, "utf8");
      total += Buffer.byteLength(content);
      if (total > this.maxTotalBytes)
        throw new Error("kushibot declarations exceed the size limit.");
      files.push({
        path: path.relative(declarationRoot, absolute).split(path.sep).join("/"),
        content,
      });
    }
    if (!files.some((file) => file.path === path.basename(manifest.types))) throw this.notBuilt();
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { packageName: manifest.name, version: manifest.version, files };
  }

  private async manifest(
    root: string,
  ): Promise<{ name: string; version: string | null; types: string }> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    } catch {
      throw new NotFoundError("kushibot package.json not found at KUSHEX_KUSHIBOT_DIR.");
    }
    const record = (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
    const types = typeof record.types === "string" ? record.types : "dist/index.d.ts";
    return {
      name: typeof record.name === "string" ? record.name : "kushibot",
      version: typeof record.version === "string" ? record.version : null,
      types: path.normalize(types),
    };
  }

  private notBuilt(): NotFoundError {
    return new NotFoundError("kushibot declarations not found. Run `npm run build` in kushibot.");
  }
}
