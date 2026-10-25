import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceFixture } from "../../../../tests/support/WorkspaceFixture.js";
import { PayloadTooLargeError } from "../../../errors/PayloadTooLargeError.js";
import { ForbiddenError } from "../../../errors/ForbiddenError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { LocalWorkspaceFileSystem } from "./LocalWorkspaceFileSystem.js";
import { WorkspacePathResolver } from "./WorkspacePathResolver.js";

let fixture: WorkspaceFixture;
let filesystem: LocalWorkspaceFileSystem;
beforeEach(async () => {
  fixture = await WorkspaceFixture.create();
  filesystem = new LocalWorkspaceFileSystem(new WorkspacePathResolver(fixture.roots), 64, 2);
});
afterEach(async () => {
  await fixture.remove();
});

describe("live workspace reads", () => {
  it("pages immediate entries and omits ignored, broken and escaping links", async () => {
    const names: string[] = [];
    let offset: number | null = 0;
    do {
      const page = await filesystem.tree("root/alpha", "", offset);
      expect(page.entries.length).toBeLessThanOrEqual(2);
      names.push(...page.entries.map((entry) => entry.name));
      offset = page.nextOffset;
    } while (offset !== null);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("src");
    for (const omitted of [".git", "node_modules", "dist", "outside", "sibling", "broken", "cross"])
      expect(names).not.toContain(omitted);
    expect((await filesystem.tree("root/alpha", "src", 0)).entries).toEqual([
      { name: "index.ts", path: "src/index.ts", kind: "file" },
    ]);
  });
  it("pages safe directories from every root with root-prefixed paths", async () => {
    const paths: string[] = [];
    let offset: number | null = 0;
    do {
      const page = await filesystem.locations(offset);
      expect(page.entries.length).toBeLessThanOrEqual(2);
      paths.push(...page.entries.map((entry) => entry.path));
      offset = page.nextOffset;
    } while (offset !== null);
    expect(paths.sort()).toEqual(["other/gamma", "root/alpha", "root/beta"]);
  });
  it("accepts directories inside a root but not the root itself", async () => {
    await expect(filesystem.validateLocation("other/gamma")).resolves.toBeUndefined();
    for (const location of ["root", "root/", "other"])
      await expect(filesystem.validateLocation(location)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("returns current text, empty files, and a binary verdict for invalid UTF-8 or NULs", async () => {
    expect(await filesystem.file("root/alpha", "src/index.ts")).toMatchObject({
      kind: "text",
      content: "export const answer = 42;\n",
    });
    await writeFile(path.join(fixture.root, "alpha/src/index.ts"), "updated");
    expect(await filesystem.file("root/alpha", "src/index.ts")).toMatchObject({
      content: "updated",
      size: 7,
    });
    expect(await filesystem.file("root/alpha", "empty.txt")).toEqual({
      path: "empty.txt",
      size: 0,
      kind: "text",
      content: "",
    });
    for (const file of ["image.bin", "invalid.bin"])
      expect(await filesystem.file("root/alpha", file)).toMatchObject({ kind: "binary" });
  });
  it("enforces the preview cap and rejects non-files", async () => {
    await expect(filesystem.file("root/alpha", "large.txt")).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
    await expect(filesystem.file("root/alpha", "src")).rejects.toBeInstanceOf(NotFoundError);
    await expect(filesystem.validateLocation("root/alpha/empty.txt")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
