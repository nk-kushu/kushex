import {
  JsonValueContract,
  type AgentRunRuntime,
  type IAgentSessionBinding,
  type AgentTaskBindingRequest,
  type IPolicy,
  type TaskInput,
} from "kushibot";
import type { WorkspaceTools } from "../../tools/WorkspaceTools";

/** Coding-specific context and acceptance; Kushibot owns session/model execution. */
export class PlanningSessionPolicy implements IPolicy<
  AgentTaskBindingRequest,
  IAgentSessionBinding<TaskInput>
> {
  constructor(
    private readonly runtime: AgentRunRuntime,
    private readonly workspaceTools: WorkspaceTools,
  ) {}

  async apply(request: AgentTaskBindingRequest): Promise<IAgentSessionBinding<TaskInput>> {
    await this.runtime.context.reporter.progress("Planning implementation.");
    const input = await new JsonValueContract().validate({
      task: request.input,
      acceptedPlan: null,
    });
    if (!input.valid) throw new Error("Invalid planning context.");
    return {
      input: input.value,
      instructions: [
        request.assignment.instructions,
        this.workspaceTools.description(true),
        'Final value: {"goal":"ordered plan, <=2048 characters","acceptanceCriteria":["outcomes/checks"],"filePaths":["permitted target"],"sourceRefs":[]}. Inspect files before planning.',
      ].join("\n"),
      tools: this.workspaceTools.bind(true),
      acceptance: {
        apply: async ({ candidate }) => ({
          accepted:
            request.input.filePaths.length === 0 ||
            candidate.filePaths.every((file) => request.input.filePaths.includes(file)),
          feedback: "Use only files in the original task's allowlist.",
        }),
      },
    };
  }
}
