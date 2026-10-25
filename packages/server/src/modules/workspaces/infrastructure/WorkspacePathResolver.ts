import { realpath } from "node:fs/promises";
import path from "node:path";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { WorkspacePath } from "../domain/WorkspacePath.js";

/**
 * Re-resolves both boundaries on every request; symlinks cannot widen a checkout.
 * Workspace paths start with the basename of one configured root, e.g. `projects/app`.
 */
export class WorkspacePathResolver {
  private readonly ignored = new Set([".git", "node_modules", "dist"]);
  private readonly roots: ReadonlyMap<string, string>;
  constructor(roots: readonly string[]) {
    this.roots = new Map(roots.map((root) => [path.basename(root), root]));
    if (this.roots.size === 0 || this.roots.size !== roots.length)
      throw new Error("Workspace roots must be non-empty with unique basenames.");
  }

  /** Root names in configuration order; each is also a valid workspace path. */
  rootNames(): readonly string[] {
    return [...this.roots.keys()];
  }

  isIgnored(name: string): boolean {
    return this.ignored.has(name);
  }

  async resolve(workspace: string, relative = ""): Promise<WorkspacePath> {
    this.validate(workspace);
    this.validate(relative);
    const [name = "", ...rest] = workspace.split("/");
    const configured = this.roots.get(name);
    if (configured === undefined) throw new NotFoundError("Workspace root is not configured.");
    try {
      const root = await realpath(configured);
      const checkout = await realpath(path.resolve(root, rest.join("/")));
      new WorkspacePath(workspace, checkout, root);
      const absolute = await realpath(path.resolve(checkout, relative));
      return new WorkspacePath(relative, absolute, checkout);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (["ENOENT", "ENOTDIR"].includes(String(error.code)))
          throw new NotFoundError("Workspace or path no longer exists.");
        if (["EACCES", "EPERM", "ELOOP"].includes(String(error.code)))
          throw new ForbiddenError("Workspace path is not accessible.");
      }
      throw error;
    }
  }

  private validate(relative: string): void {
    if (
      relative.includes("\0") ||
      relative.includes("\\") ||
      path.posix.isAbsolute(relative) ||
      path.win32.isAbsolute(relative) ||
      /^[a-z]:/i.test(relative)
    ) {
      throw new ForbiddenError("Only relative workspace paths are allowed.");
    }
    if (relative.split("/").some((part) => part === ".." || this.ignored.has(part))) {
      throw new ForbiddenError("Path is outside the readable workspace.");
    }
  }
}
