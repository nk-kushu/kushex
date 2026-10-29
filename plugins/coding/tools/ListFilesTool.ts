import Joi from "joi";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import type { JsonValue } from "kushibot";
import { JsonValueContract, type ITool, type ToolDescriptor } from "kushibot";
import { JoiArgumentsContract } from "kushibot";

export class ListFilesTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract("list_files-arguments", Joi.object({
    path: Joi.string().allow("").required(),
  }));

  readonly resultContract = new JsonValueContract();
  private readonly description =
    'list_files {"path":""}: lists immediate workspace directory entries; use directory paths to explore.';

  get descriptor(): ToolDescriptor {
    return {
      id: "list_files",
      version: "1",
      description: this.description,
      inputSchema: this.argumentsContract.schema,
      maxArgumentBytes: 65536,
      maxOutputBytes: 65536,
    };
  }

  constructor(
    private readonly directory: string,
    private readonly allowedFiles: readonly string[],
  ) {}

  async execute(input: JsonValue): Promise<JsonValue> {
    try {
      const args = input as Record<string, JsonValue>;
      return await this.list(args.path as string);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace operation failed." };
    }
  }
  private async list(directory: string): Promise<JsonValue> {
    const location =
      directory === "" ? await realpath(this.directory) : await this.resolvePath(directory);
    const entries = await readdir(location, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          !entry.isSymbolicLink() && entry.name !== ".git" && entry.name !== "node_modules",
      )
      .map((entry) => ({
        path: directory ? directory + "/" + entry.name : entry.name,
        directory: entry.isDirectory(),
      }))
      .filter(
        (entry) =>
          this.allowedFiles.length === 0 ||
          this.allowedFiles.some(
            (file) => file === entry.path || (entry.directory && file.startsWith(entry.path + "/")),
          ),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 256);
  }

  private async resolvePath(file: string): Promise<string> {
    const root = await realpath(this.directory);
    const parts = file.split("/");
    const hasInvalidCharacters = !/^[A-Za-z0-9_.@/-]+$/.test(file);
    const hasInvalidSegments = parts.some((part) => !part || part === "." || part === "..");
    if (hasInvalidCharacters || hasInvalidSegments || path.isAbsolute(file))
      throw new Error("Path is outside the task file allowlist.");
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
          throw new Error("Symlinks and non-directory parents are not permitted.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (index === parts.length - 1) break;
        return path.join(root, ...parts);
      }
    }
    return current;
  }
}
