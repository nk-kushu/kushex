import {
  BoundedToolRunner,
  DebugRecordingArtifactWriter,
  JsonValueContract,
  ToolDispatcher,
  ToolRegistry,
  type AgentRunRuntime,
  type EditingResult,
  type IAgentToolCall,
  type IArtifactWriter,
  type ITool,
  type JsonValue,
} from "kushibot";
import type { CodingCheck } from "../CodingAgentOptions";
import { WorkspaceEvidence } from "kushibot";
import { InMemoryToolOperationJournal } from "kushibot";
import { CliTool } from "./CliTool";
import { CliWorkspace } from "../infrastructure/workspace/CliWorkspace";
import { SandboxedCli } from "../infrastructure/sandbox/SandboxedCli";

/** Composes workspace ITool implementations with Kushibot's registry and dispatcher.
 * Kushibot owns validation, execution bounds, usage accounting, and receipt replay.
 * Workspace collaborators retain filesystem boundaries and completion evidence.
 */
export class WorkspaceTools {
  private readonly workspaceEvidence: WorkspaceEvidence;
  private readonly json = new JsonValueContract();
  private readonly registry = new ToolRegistry(this.json);
  private readonly planningRegistry = new ToolRegistry(this.json);
  private readonly journal = new InMemoryToolOperationJournal();
  private readonly runner: BoundedToolRunner;
  private readonly tools: readonly ITool[];
  private readonly workspace: CliWorkspace;
  private readonly planningTool: ITool;

  constructor(
    directory: string,
    private readonly files: readonly string[],
    private readonly checks: readonly CodingCheck[],
    private readonly runtime: AgentRunRuntime,
    artifacts: IArtifactWriter,
  ) {
    this.workspace = new CliWorkspace(directory, files);
    this.workspaceEvidence = new WorkspaceEvidence(
      (file) => this.workspace.read(file),
      checks,
      new DebugRecordingArtifactWriter(artifacts, runtime.debug),
      runtime.context.identity.runId ?? runtime.context.identity.operationId,
      runtime.context.signal,
    );
    this.runner = new BoundedToolRunner(runtime.clock);
    const sandbox = new SandboxedCli();

    // The workspace tool is the only one that can modify the workspace. It runs all checks.
    this.tools = [new CliTool(this.workspace, sandbox, this.workspaceEvidence, checks, false)];

    // The planning tool is read-only and does not run checks. It is used for planning and status inspection.
    this.planningTool = new CliTool(this.workspace, sandbox, this.workspaceEvidence, [], true);
  }

  async initialize(): Promise<void> {
    await this.workspace.initialize(this.workspaceEvidence);
    await this.journal.initialize();
    for (const tool of this.tools) await this.registry.register(tool);
    await this.planningRegistry.register(this.planningTool);
  }

  bind(readOnly: boolean): IAgentToolCall {
    const allowed = ["cli"];
    return new ToolDispatcher(
      readOnly ? this.planningRegistry : this.registry,
      { authorize: async (tool) => allowed.includes(tool.id) },
      this.journal,
      this.runtime.stores.usage,
      this.runtime.budgetScopeId,
      this.runtime.context.scope,
      allowed,
      this.runtime.clock,
      this.runtime.ids,
      this.runner,
      this.json,
      60_000,
    );
  }

  description(readOnly: boolean): string {
    return [
      ...this.registry.describe(["cli"]).map((tool) => tool.description),
      this.files.length
        ? `Permitted paths: ${JSON.stringify(this.files)}.`
        : "Scope: the entire workspace. Use shell commands to inspect files. Follow project instructions.",
      readOnly
        ? "Planning: the workspace is mounted read-only."
        : "Editing: workspace writes are enabled.",
      `Required checks: ${JSON.stringify(this.checks.map((check) => check.id))}.`,
    ].join("\n");
  }

  async status(): Promise<EditingResult> {
    await this.workspace.refresh(this.workspaceEvidence);
    return this.workspaceEvidence.status();
  }

  async accepts(candidate: EditingResult): Promise<boolean> {
    await this.workspace.refresh(this.workspaceEvidence);
    return this.workspaceEvidence.accepts(candidate);
  }

  evidence(): Readonly<Record<string, JsonValue>> {
    return this.workspaceEvidence.evidence();
  }
}
