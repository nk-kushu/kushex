import Joi from "joi";
import type { IExecutionContext, JsonValue } from "kushibot";
import type { CodingCheck } from "../CodingAgentOptions";
import { spawn } from "node:child_process";
import type { IClock } from "kushibot";
import { realpath } from "node:fs/promises";
import type { WorkspaceEvidence } from "kushibot";
import { JsonValueContract, type ITool, type ToolDescriptor } from "kushibot";
import { JoiArgumentsContract } from "kushibot";

export class RunCheckTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract("run_check-arguments", Joi.object({
    id: Joi.string().min(1).required(),
  }));
  readonly resultContract = new JsonValueContract();
  private readonly description =
    'run_check {"id":"registered check"}: runs a host-configured command.';
  get descriptor(): ToolDescriptor {
    return {
      id: "run_check",
      version: "1",
      description: this.description,
      inputSchema: this.argumentsContract.schema,
      maxArgumentBytes: 65536,
      maxOutputBytes: 65536,
    };
  }

  constructor(
    private readonly checks: readonly CodingCheck[],
    private readonly directory: string,
    private readonly clock: IClock,
    private readonly evidence: WorkspaceEvidence,
  ) {}

  async execute(input: JsonValue, context: IExecutionContext): Promise<JsonValue> {
    try {
      const args = input as Record<string, JsonValue>;
      const check = this.checks.find((item) => item.id === args.id);
      if (!check) throw new Error("Unknown check.");
      const before = await this.evidence.revision();
      const result = await this.run(check, context);
      const after = await this.evidence.revision();
      this.evidence.recordCheck(check.id, before, after, result.exitCode);
      return { ...result, checkId: check.id, snapshotRef: after };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace operation failed." };
    }
  }
  private async run(
    check: CodingCheck,
    context: IExecutionContext,
  ): Promise<{ exitCode: number | null; output: string }> {
    const timeout = Math.min(
      60_000,
      context.deadlineEpochMs === null
        ? 60_000
        : Math.max(1, context.deadlineEpochMs - this.clock.nowEpochMs()),
    );
    const workingDirectory = await realpath(this.directory);
    return new Promise((resolve, reject) => {
      const grouped = process.platform !== "win32";
      const child = spawn(check.command, [...check.args], {
        cwd: workingDirectory,
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
}
