import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  zeroUsage,
  type EditingResult,
  type IAgentToolCall,
  type IExecutionContext,
  type IClock,
  type IUsageLedgerStore,
  type JsonValue,
  type ToolCallRequest,
  type ToolDispatchOutcome,
} from "kushibot";
import type { CodingCheck } from "./CodingAgentOptions";

/** File tools are confined to explicit task paths. Check commands are trusted host inputs. */
export class WorkspaceTools {
  private root = "";
  private base = "";
  private readonly initial = new Map<string, string | null>();
  private readonly passed = new Map<string, string>();
  private readonly artifacts = new Map<string, JsonValue>();
  constructor(
    private readonly directory: string,
    private readonly files: readonly string[],
    private readonly checks: readonly CodingCheck[],
    private readonly usage: IUsageLedgerStore,
    private readonly budgetScopeId: string,
    private readonly clock: IClock,
  ) {}

  async initialize(): Promise<void> {
    this.root = await realpath(this.directory);
    for (const file of this.files) this.initial.set(file, await this.read(file));
    this.base = await this.revision();
  }

  bind(readOnly: boolean): IAgentToolCall {
    return { dispatch: (request, context) => this.dispatch(readOnly, request, context) };
  }

  description(readOnly: boolean): string {
    return [
      'read_file {"path":"relative/path"}: returns content and sha256 hash (null for a missing file).',
      ...(!readOnly
        ? [
            'write_file {"path":"relative/path","content":"...","expectedHash":"hash from read_file, or null"}: replaces an explicitly permitted file. Creates missing parent directories.',
            'run_check {"id":"registered check"}: runs a host-configured command.',
            "status {}: returns actual EditingResult references and check failures; copy these references into your final result.",
          ]
        : []),
      `Permitted paths: ${JSON.stringify(this.files)}.`,
      `Required checks: ${JSON.stringify(this.checks.map((check) => check.id))}.`,
    ].join("\n");
  }

  async status(): Promise<EditingResult> {
    const revision = await this.revision();
    const changed: string[] = [];
    const refs: string[] = [];
    for (const file of this.files) {
      const content = await this.read(file);
      if (content === this.initial.get(file)) continue;
      changed.push(file);
      const ref = `change:${this.hash(JSON.stringify([file, this.initial.get(file), content]))}`;
      this.artifacts.set(ref, {
        path: file,
        before: this.initial.get(file) ?? null,
        after: content,
      });
      refs.push(ref);
    }
    return {
      summary: "Workspace implementation result.",
      baseSnapshotRef: this.base,
      resultSnapshotRef: revision,
      changedPaths: changed,
      changeArtifactRefs: refs,
      unresolved: this.checks
        .filter((check) => this.passed.get(check.id) !== revision)
        .map((check) => `Required check has not passed on the current files: ${check.id}`),
    };
  }

  async accepts(candidate: EditingResult): Promise<boolean> {
    const actual = await this.status();
    return (
      candidate.unresolved.length === 0 &&
      actual.unresolved.length === 0 &&
      candidate.baseSnapshotRef === actual.baseSnapshotRef &&
      candidate.resultSnapshotRef === actual.resultSnapshotRef &&
      JSON.stringify(candidate.changedPaths) === JSON.stringify(actual.changedPaths) &&
      JSON.stringify(candidate.changeArtifactRefs) === JSON.stringify(actual.changeArtifactRefs)
    );
  }

  evidence(): Readonly<Record<string, JsonValue>> {
    return Object.fromEntries(this.artifacts);
  }

  private async dispatch(
    readOnly: boolean,
    request: ToolCallRequest,
    context: IExecutionContext,
  ): Promise<ToolDispatchOutcome> {
    if (
      context.signal.aborted ||
      (context.deadlineEpochMs !== null && this.clock.nowEpochMs() >= context.deadlineEpochMs)
    )
      return {
        status: "stopped",
        reason: {
          code: context.signal.aborted ? "cancelled" : "deadline-reached",
          message: "Workspace operation stopped.",
        },
      };
    if (readOnly && request.toolId !== "read_file")
      return { status: "rejected", code: "READ_ONLY_PLANNING" };
    const reservation = await this.usage.mutate((ledger) =>
      ledger.reserve(request.operationId, this.budgetScopeId, { ...zeroUsage, toolCalls: 1 }),
    );
    if (!reservation.admitted)
      return {
        status: "stopped",
        reason: { code: "limit-reached", message: "Tool call budget exhausted." },
      };
    if (reservation.replayed) return { status: "uncertain", operationId: request.operationId };
    try {
      const args = this.arguments(request.arguments);
      let value: JsonValue;
      if (request.toolId === "read_file") {
        const content = await this.read(this.text(args.path));
        value = { content, hash: content === null ? null : this.hash(content) };
      } else if (request.toolId === "write_file") {
        const file = this.text(args.path),
          content = this.text(args.content, true);
        if (Buffer.byteLength(content) > 64 * 1024) throw new Error("File content exceeds 64 KiB.");
        const before = await this.read(file);
        if (args.expectedHash !== (before === null ? null : this.hash(before)))
          throw new Error("File changed since it was read.");
        const destination = await this.resolve(file, true);
        const handle = await open(
          destination,
          constants.O_WRONLY |
            constants.O_NOFOLLOW |
            (before === null ? constants.O_CREAT | constants.O_EXCL : 0),
          0o644,
        );
        try {
          if ((await handle.stat()).nlink !== 1)
            throw new Error("Hard-linked files are not supported.");
          // Re-check the opened inode before changing it.
          const current = before === null ? null : await this.read(file);
          if (current !== before) throw new Error("File changed before write.");
          await handle.truncate(0);
          await handle.writeFile(content, "utf8");
        } finally {
          await handle.close();
        }
        this.passed.clear();
        value = { written: file, hash: this.hash(content) };
      } else if (request.toolId === "status") {
        value = { ...(await this.status()) };
      } else if (request.toolId === "run_check") {
        const check = this.checks.find((item) => item.id === args.id);
        if (!check) throw new Error("Unknown check.");
        const before = await this.revision();
        const result = await this.runCheck(check, context);
        const after = await this.revision();
        if (result.exitCode === 0 && before === after) this.passed.set(check.id, after);
        else this.passed.delete(check.id);
        value = { ...result, checkId: check.id, snapshotRef: after };
      } else return { status: "rejected", code: "UNKNOWN_TOOL" };
      return {
        status: "completed",
        replayed: false,
        observation: {
          operationId: request.operationId,
          toolId: request.toolId,
          toolVersion: "1",
          value,
        },
      };
    } catch (error) {
      return {
        status: "completed",
        replayed: false,
        observation: {
          operationId: request.operationId,
          toolId: request.toolId,
          toolVersion: "1",
          value: { error: error instanceof Error ? error.message : "Workspace operation failed." },
        },
      };
    } finally {
      await this.usage.mutate((ledger) =>
        ledger.settle(request.operationId, { ...zeroUsage, toolCalls: 1 }),
      );
    }
  }

  private async runCheck(
    check: CodingCheck,
    context: IExecutionContext,
  ): Promise<{ exitCode: number | null; output: string }> {
    const timeout = Math.min(
      60_000,
      context.deadlineEpochMs === null
        ? 60_000
        : Math.max(1, context.deadlineEpochMs - this.clock.nowEpochMs()),
    );
    return new Promise((resolve, reject) => {
      const grouped = process.platform !== "win32";
      const child = spawn(check.command, [...check.args], {
        cwd: this.root,
        shell: false,
        detached: grouped,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stop = () => {
        if (!child.pid) return;
        try {
          if (grouped) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(stop, timeout);
      context.signal.addEventListener("abort", stop, { once: true });
      if (context.signal.aborted) stop();
      const cleanup = () => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", stop);
      };
      let output = "";
      const collect = (data: Buffer) => {
        output = (output + data.toString("utf8")).slice(-16_384);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (exitCode) => {
        cleanup();
        resolve({ exitCode, output });
      });
    });
  }

  private async read(file: string): Promise<string | null> {
    const location = await this.resolve(file);
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
  private async resolve(file: string, createParents = false): Promise<string> {
    if (
      !this.files.includes(file) ||
      !/^[A-Za-z0-9_.@/-]+$/.test(file) ||
      file.split("/").some((part) => !part || part === "." || part === "..") ||
      path.isAbsolute(file)
    )
      throw new Error("Path is outside the task file allowlist.");
    let current = this.root;
    const parts = file.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
          throw new Error("Symlinks and non-directory parents are not permitted.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (index === parts.length - 1) break;
        if (!createParents) return path.join(this.root, ...parts);
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
  private async revision(): Promise<string> {
    const values = await Promise.all(this.files.map(async (file) => [file, await this.read(file)]));
    return `snapshot:${this.hash(JSON.stringify(values))}`;
  }
  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
  private arguments(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected tool argument object.");
    return value as Record<string, unknown>;
  }
  private text(value: unknown, empty = false): string {
    if (typeof value !== "string" || (!empty && !value))
      throw new Error("Expected string argument.");
    return value;
  }
}
