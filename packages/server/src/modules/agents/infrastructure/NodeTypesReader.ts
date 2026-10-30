import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { LibraryTypesDto, NodeTypesDto } from "@kushex/contracts";
import type { NodeTypesSource } from "../application/LibraryTypesSource.js";
import { DeclarationDirectoryReader } from "./DeclarationDirectoryReader.js";

/** Reads the installed `@types/node`, and `undici-types` which its declarations import. */
export class NodeTypesReader implements NodeTypesSource {
  constructor(private readonly directory = new DeclarationDirectoryReader()) {}

  async read(): Promise<NodeTypesDto> {
    const node = await this.packageRoot(import.meta.url, "@types/node");
    const undici = await this.packageRoot(path.join(node, "package.json"), "undici-types");
    return { packages: await Promise.all([this.package(node), this.package(undici)]) };
  }

  /** The real directory: pnpm links packages, and only the real one has their dependencies. */
  private packageRoot(from: string, name: string): Promise<string> {
    return realpath(path.dirname(createRequire(from).resolve(`${name}/package.json`)));
  }

  private async package(root: string): Promise<LibraryTypesDto> {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    return {
      packageName: manifest.name,
      version: manifest.version,
      files: await this.directory.read(root, (file) => this.isForOlderTypeScript(file)),
    };
  }

  /**
   * `typesVersions` folders such as `ts5.6/`. The editor loads every declaration it is given,
   * so these would redeclare what the main files declare.
   */
  private isForOlderTypeScript(file: string): boolean {
    return /^ts\d/.test(file);
  }
}
