import {
  BoundedToolRunner,
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
import type { CodingCheck } from "./CodingAgentOptions";
import { WorkspaceEvidence } from "kushibot";
import { InMemoryToolOperationJournal } from "kushibot";
import { ListFilesTool } from "./tools/ListFilesTool";
import { ReadFileTool } from "./tools/ReadFileTool";
import { WriteFileTool } from "./tools/WriteFileTool";
import { RunCheckTool } from "./tools/RunCheckTool";
import { StatusTool } from "./tools/StatusTool";

/** Composes workspace ITool implementations with Kushibot's registry and dispatcher.
 * Kushibot owns validation, execution bounds, usage accounting, and receipt replay.
 * Workspace collaborators retain filesystem boundaries and completion evidence.
 */
export class WorkspaceTools {
  private readonly workspaceEvidence: WorkspaceEvidence;
  private readonly json = new JsonValueContract();
  private readonly registry = new ToolRegistry(this.json);
  private readonly journal = new InMemoryToolOperationJournal();
  private readonly runner: BoundedToolRunner;
  private readonly tools: readonly ITool[];
  private readonly planningToolIds = ["list_files", "read_file"];

  constructor(
    directory: string,
    private readonly files: readonly string[],
    private readonly checks: readonly CodingCheck[],
    private readonly runtime: AgentRunRuntime,
    artifacts: IArtifactWriter,
  ) {
    const reader = new ReadFileTool(directory, files, (file, content) => {
      this.workspaceEvidence.track(file, content);
    });
    this.workspaceEvidence = new WorkspaceEvidence(
      (file) => reader.read(file),
      checks,
      artifacts,
      runtime.context.identity.runId ?? runtime.context.identity.operationId,
      runtime.context.signal,
    );
    this.runner = new BoundedToolRunner(runtime.clock);
    this.tools = [
      new ListFilesTool(directory, files),
      reader,
      new WriteFileTool(directory, files, this.workspaceEvidence, reader),
      new RunCheckTool(checks, directory, runtime.clock, this.workspaceEvidence),
      new StatusTool(this.workspaceEvidence),
    ];
  }

  async initialize(): Promise<void> {
    await this.workspaceEvidence.initialize(this.files);
    await this.journal.initialize();
    for (const tool of this.tools) await this.registry.register(tool);
  }

  bind(readOnly: boolean): IAgentToolCall {
    const allowed = this.allowedToolIds(readOnly);
    return new ToolDispatcher(
      this.registry,
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
      ...this.registry.describe(this.allowedToolIds(readOnly)).map((tool) => tool.description),
      this.files.length
        ? `Permitted paths: ${JSON.stringify(this.files)}.`
        : "Scope: the entire workspace. Discover files with list_files. Follow project instructions.",
      `Required checks: ${JSON.stringify(this.checks.map((check) => check.id))}.`,
    ].join("\n");
  }

  async status(): Promise<EditingResult> {
    return this.workspaceEvidence.status();
  }

  async accepts(candidate: EditingResult): Promise<boolean> {
    return this.workspaceEvidence.accepts(candidate);
  }

  evidence(): Readonly<Record<string, JsonValue>> {
    return this.workspaceEvidence.evidence();
  }

  private allowedToolIds(readOnly: boolean): readonly string[] {
    return readOnly ? this.planningToolIds : this.tools.map((tool) => tool.descriptor.id);
  }
}
