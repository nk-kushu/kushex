import Joi from "joi";
import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ReadFileTool } from "./ReadFileTool";
import type { JsonValue } from "kushibot";
import type { WorkspaceEvidence } from "kushibot";
import { JsonValueContract, type ITool, type ToolDescriptor } from "kushibot";
import { JoiArgumentsContract } from "kushibot";

export class WriteFileTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract("write_file-arguments", Joi.object({
    path: Joi.string().min(1).required(),
    content: Joi.string().allow("").required(),
    expectedHash: Joi.string().allow("", null).required(),
  }));
  readonly resultContract = new JsonValueContract();
  private readonly description =
    'write_file {"path":"relative/path","content":"...","expectedHash":"hash from read_file, or null"}: replaces a permitted workspace file. Creates missing parent directories.';
  get descriptor(): ToolDescriptor {
    return {
      id: "write_file",
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
    private readonly evidence: WorkspaceEvidence,
    private readonly reader: ReadFileTool,
  ) {}

  async execute(input: JsonValue): Promise<JsonValue> {
    try {
      const args = input as Record<string, JsonValue>;
      const file = args.path as string;
      const content = args.content as string;
      if (Buffer.byteLength(content) > 64 * 1024) throw new Error("File content exceeds 64 KiB.");
      const before = await this.reader.read(file);
      this.evidence.track(file, before);
      const currentHash = before === null ? null : this.evidence.hash(before);
      if (args.expectedHash !== currentHash) throw new Error("File changed since it was read.");
      await this.write(file, content, before);
      this.evidence.invalidateChecks();
      return { written: file, hash: this.evidence.hash(content) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace operation failed." };
    }
  }
  private async write(file: string, content: string, before: string | null): Promise<void> {
    const destination = await this.resolvePath(file);
    const createFlags = before === null ? constants.O_CREAT | constants.O_EXCL : 0;
    const flags = constants.O_WRONLY | constants.O_NOFOLLOW | createFlags;
    const handle = await open(destination, flags, 0o644);
    try {
      if ((await handle.stat()).nlink !== 1)
        throw new Error("Hard-linked files are not supported.");
      // Re-check the opened inode before changing it.
      const current = before === null ? null : await this.reader.read(file);
      if (current !== before) throw new Error("File changed before write.");
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
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
        try {
          await mkdir(current);
        } catch (createdError) {
          if ((createdError as NodeJS.ErrnoException).code !== "EEXIST") throw createdError;
        }
        const created = await lstat(current);
        if (!created.isDirectory() || created.isSymbolicLink())
          throw new Error("Expected a real parent directory.");
      }
    }
    return current;
  }
}
