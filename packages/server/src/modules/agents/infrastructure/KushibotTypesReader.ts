import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LibraryTypesDto } from "@kushex/contracts";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { LibraryTypesSource } from "../application/LibraryTypesSource.js";
import { DeclarationDirectoryReader } from "./DeclarationDirectoryReader.js";

/**
 * Reads the built `.d.ts` files of a kushibot checkout. Without a configured
 * checkout the editor still works, only without kushibot type checking.
 */
export class KushibotTypesReader implements LibraryTypesSource {
  constructor(
    /** Absolute kushibot package directory (the one holding its package.json), or null. */
    private readonly packageRoot: string | null,
    private readonly directory = new DeclarationDirectoryReader(),
  ) {}

  async read(): Promise<LibraryTypesDto> {
    if (!this.packageRoot) return { packageName: "kushibot", version: null, files: [] };
    const manifest = await this.manifest(this.packageRoot);
    const declarationRoot = path.dirname(path.resolve(this.packageRoot, manifest.types));
    const files = await this.directory.read(declarationRoot).catch((failure: unknown) => {
      if ((failure as NodeJS.ErrnoException).code === "ENOENT") throw this.notBuilt();
      throw failure;
    });
    if (!files.some((file) => file.path === path.basename(manifest.types))) throw this.notBuilt();
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
