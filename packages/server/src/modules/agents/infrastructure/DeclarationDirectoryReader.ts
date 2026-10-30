import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LibraryTypesDto } from "@kushex/contracts";

/** Reads the `.d.ts` files under a directory, with paths relative to it. */
export class DeclarationDirectoryReader {
  constructor(private readonly maxTotalBytes = 16 * 1024 * 1024) {}

  /** `skip` leaves out files by their relative path. */
  async read(
    root: string,
    skip: (relativePath: string) => boolean = () => false,
  ): Promise<LibraryTypesDto["files"]> {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const files: { path: string; content: string }[] = [];
    let total = 0;
    // Dirent.isFile() is false for symlinks, so links out of the package are skipped.
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (skip(relative)) continue;
      const content = await readFile(absolute, "utf8");
      total += Buffer.byteLength(content);
      if (total > this.maxTotalBytes)
        throw new Error(`${root} declarations exceed the size limit.`);
      files.push({ path: relative, content });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
}
