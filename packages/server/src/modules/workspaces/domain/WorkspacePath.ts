import path from "node:path";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";

/** A relative path paired with the canonical absolute path validated by the resolver. */
export class WorkspacePath {
  constructor(
    readonly relative: string,
    readonly absolute: string,
    boundary: string,
  ) {
    const fromBoundary = path.relative(boundary, absolute);
    if (
      fromBoundary === ".." ||
      fromBoundary.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromBoundary)
    ) {
      throw new ForbiddenError("Path is outside the workspace.");
    }
  }
}
