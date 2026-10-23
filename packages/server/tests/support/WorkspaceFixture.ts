import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class WorkspaceFixture {
  private constructor(
    readonly directory: string,
    readonly root: string,
  ) {}
  static async create(): Promise<WorkspaceFixture> {
    const directory = await mkdtemp(path.join(tmpdir(), "kushex-workspaces-"));
    const root = path.join(directory, "root");
    const fixture = new WorkspaceFixture(directory, root);
    for (const relative of [
      "alpha/src",
      "alpha/.git",
      "alpha/node_modules",
      "alpha/dist",
      "beta",
      "../outside",
      "alpha/__proto__",
    ])
      await mkdir(path.join(root, relative), { recursive: true });
    await writeFile(path.join(root, "alpha/src/index.ts"), "export const answer = 42;\n");
    await writeFile(path.join(root, "alpha/empty.txt"), "");
    await writeFile(path.join(root, "alpha/image.bin"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, "alpha/invalid.bin"), Buffer.from([0xff]));
    await writeFile(path.join(root, "alpha/large.txt"), "x".repeat(80));
    await writeFile(path.join(root, "beta/secret.txt"), "sibling secret");
    await writeFile(path.join(directory, "outside/secret.txt"), "outside secret");
    await symlink("../beta", path.join(root, "alpha/sibling"));
    await symlink("../../outside", path.join(root, "alpha/outside"));
    await symlink("src/index.ts", path.join(root, "alpha/alias.ts"));
    await symlink("../outside", path.join(root, "escape"));
    await symlink("missing", path.join(root, "alpha/broken"));
    return fixture;
  }
  remove(): Promise<void> {
    return rm(this.directory, { recursive: true, force: true });
  }
}
