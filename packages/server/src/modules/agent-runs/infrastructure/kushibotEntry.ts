import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The module URL that `import "kushibot"` loads from a kushibot package directory. */
export function kushibotEntry(directory: string): string {
  let entry = "dist/index.js";
  try {
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as {
      main?: unknown;
      exports?: { ".": { import?: unknown } };
    };
    const declared = manifest.exports?.["."]?.import ?? manifest.main;
    if (typeof declared === "string") entry = declared;
  } catch {
    // A missing manifest falls back to the conventional build output.
  }
  return pathToFileURL(path.resolve(directory, entry)).href;
}
