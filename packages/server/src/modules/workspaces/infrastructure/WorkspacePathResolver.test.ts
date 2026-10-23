import { mkdir, rename, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceFixture } from "../../../../tests/support/WorkspaceFixture.js";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { WorkspacePathResolver } from "./WorkspacePathResolver.js";

let fixture: WorkspaceFixture;
let resolver: WorkspacePathResolver;
beforeEach(async () => {
  fixture = await WorkspaceFixture.create();
  resolver = new WorkspacePathResolver(fixture.root);
});
afterEach(async () => {
  await fixture.remove();
});

describe("workspace containment", () => {
  it("resolves files and internal symlinks inside the selected checkout", async () => {
    const direct = await resolver.resolve("alpha", "src/index.ts");
    const alias = await resolver.resolve("alpha", "alias.ts");
    expect(alias.absolute).toBe(direct.absolute);
    expect(direct.relative).toBe("src/index.ts");
  });
  it.each([
    "../beta/secret.txt",
    "src/../../beta/secret.txt",
    "/etc/passwd",
    "C:\\Windows\\secret",
    "C:secret",
    "src\\index.ts",
    "bad\0name",
    ".git/config",
    "node_modules/pkg/index.js",
    "dist/index.js",
  ])("rejects unsafe request path %j", async (input) => {
    await expect(resolver.resolve("alpha", input)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("rejects escapes through sibling and outside-root symlinks", async () => {
    await expect(resolver.resolve("alpha", "sibling/secret.txt")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(resolver.resolve("alpha", "outside/secret.txt")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(resolver.resolve("escape", "secret.txt")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("does not confuse a matching path prefix with containment", async () => {
    await mkdir(path.join(fixture.root, "alpha-other"));
    await symlink("../alpha-other", path.join(fixture.root, "alpha/prefix"));
    await expect(resolver.resolve("alpha", "prefix")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("rechecks stale workspace pointers and symlink replacements", async () => {
    await resolver.resolve("alpha", "src/index.ts");
    await rename(path.join(fixture.root, "alpha"), path.join(fixture.root, "old"));
    await expect(resolver.resolve("alpha", "src/index.ts")).rejects.toBeInstanceOf(NotFoundError);
    await symlink("../outside", path.join(fixture.root, "alpha"));
    await expect(resolver.resolve("alpha", "secret.txt")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
