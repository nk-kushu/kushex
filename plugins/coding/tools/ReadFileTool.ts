import Joi from "joi";
import { createHash } from "node:crypto";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { JsonValue } from "kushibot";
import { JsonValueContract, type ITool, type ToolDescriptor } from "kushibot";
import { JoiArgumentsContract } from "kushibot";

export class ReadFileTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract("read_file-arguments", Joi.object({
    path: Joi.string().min(1).required(),
  }));
  readonly resultContract = new JsonValueContract();
  private readonly description =
    'read_file {"path":"relative/path"}: returns content and sha256 hash (null for a missing file).';
  get descriptor(): ToolDescriptor {
    return {
      id: "read_file",
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
    private readonly onRead: (file: string, content: string | null) => void,
  ) {}

  async execute(input: JsonValue): Promise<JsonValue> {
    try {
      const file = (input as Record<string, JsonValue>).path as string;
      const content = await this.read(file);
      this.onRead(file, content);
      return {
        content,
        hash: content === null ? null : createHash("sha256").update(content).digest("hex"),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace operation failed." };
    }
  }
  async read(file: string): Promise<string | null> {
    const location = await this.resolvePath(file);
    try {
      const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024)
          throw new Error("Expected a regular file up to 64 KiB with one link.");
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async resolvePath(file: string): Promise<string> {
    const root = await realpath(this.directory);
    const parts = file.split("/");
    const isAllowed = this.allowedFiles.length === 0 || this.allowedFiles.includes(file);
    const hasInvalidCharacters = !/^[A-Za-z0-9_.@/-]+$/.test(file);
    const hasInvalidSegments = parts.some((part) => !part || part === "." || part === "..");
    if (!isAllowed || hasInvalidCharacters || hasInvalidSegments || path.isAbsolute(file))
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
