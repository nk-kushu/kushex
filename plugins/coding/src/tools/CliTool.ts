import Joi from "joi";
import {
  JoiArgumentsContract,
  JsonValueContract,
  type IExecutionContext,
  type ITool,
  type JsonValue,
  type WorkspaceEvidence,
  type EditingResult,
} from "kushibot";
import type { CodingCheck } from "../CodingAgentOptions";
import type { CliWorkspace } from "../infrastructure/workspace/CliWorkspace";
import type { CliResult, SandboxedCli } from "../infrastructure/sandbox/SandboxedCli";

/** The sole model-facing tool. Checks and change evidence remain host-owned. */
export class CliTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract(
    "cli-arguments",
    Joi.object({
      command: Joi.string().min(1).max(8192).required(),
    }),
  );
  readonly resultContract = new JsonValueContract();
  readonly descriptor = {
    id: "cli",
    version: "1",
    description:
      'cli {"command":"shell command"}: runs /bin/sh in a network-isolated Linux workspace. Returns output and workspace status. Use command "true" to refresh status. Editing calls also run all host-registered checks.',
    inputSchema: this.argumentsContract.schema,
    maxArgumentBytes: 16_384,
    maxOutputBytes: 65_536,
  };
  constructor(
    private readonly workspace: CliWorkspace,
    private readonly sandbox: SandboxedCli,
    private readonly evidence: WorkspaceEvidence,
    private readonly checks: readonly CodingCheck[],
    private readonly readOnly: boolean,
  ) {}

  async execute(input: JsonValue, context: IExecutionContext): Promise<JsonValue> {
    try {
      const command = (input as { command: string }).command;
      const result = await this.workspace.execute(this.readOnly, (directory) =>
        this.sandbox.run(directory, ["/bin/sh", "-c", command], this.readOnly, context),
      );
      context.signal.throwIfAborted();
      await this.workspace.refresh(this.evidence);
      const checks: (CliResult & { id: string })[] = [];
      if (!this.readOnly) {
        for (const check of this.checks) {
          const before = await this.evidence.revision();
          const checked = await this.workspace.execute(false, (directory) =>
            this.sandbox.run(directory, [check.command, ...check.args], false, context),
          );
          await this.workspace.refresh(this.evidence);
          this.evidence.recordCheck(
            check.id,
            before,
            await this.evidence.revision(),
            checked.exitCode,
          );
          checks.push({
            id: check.id,
            ...checked,
            output: checked.output.slice(0, 1024),
            truncated: checked.truncated || checked.output.length > 1024,
          });
        }
      }
      return this.boundedResponse(result, checks, await this.evidence.status());
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Sandboxed CLI failed." };
    }
  }

  private boundedResponse(
    result: CliResult,
    checks: readonly (CliResult & { id: string })[],
    status: EditingResult,
  ): JsonValue {
    const response = {
      ...result,
      checks: checks.map((check) => ({ ...check })),
      status: { ...status },
    };
    const outputs = [response, ...response.checks];
    // Escaping control characters can make JSON much larger than the raw output.
    while (Buffer.byteLength(JSON.stringify(response)) > 60_000) {
      const longest = outputs.reduce((a, b) => (a.output.length >= b.output.length ? a : b));
      if (!longest.output.length) throw new Error("CLI evidence exceeds its output budget.");
      longest.output = longest.output.slice(0, Math.floor(longest.output.length / 2));
      longest.truncated = true;
    }
    return response;
  }
}
