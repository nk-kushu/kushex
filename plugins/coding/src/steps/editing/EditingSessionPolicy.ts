import {
  JsonValueContract,
  type AgentRunRuntime,
  type IAgentSessionBinding,
  type AgentTaskBindingRequest,
  type EditingResult,
  type IPolicy,
} from "kushibot";
import type { WorkspaceTools } from "../../tools/WorkspaceTools";

/** Binds the accepted plan, editing tools, and implementation acceptance policy. */
export class EditingSessionPolicy implements IPolicy<
  AgentTaskBindingRequest,
  IAgentSessionBinding<EditingResult>
> {
  constructor(
    private readonly runtime: AgentRunRuntime,
    private readonly workspaceTools: WorkspaceTools,
  ) {}

  async apply(request: AgentTaskBindingRequest): Promise<IAgentSessionBinding<EditingResult>> {
    await this.runtime.context.reporter.progress("Implementing accepted plan.");
    const snapshot = await this.runtime.stores.workflow.read();
    const plan = snapshot.accepted.find((item) => item.stepId === "plan");
    if (!plan || !request.input.sourceRefs.includes(plan.receiptRef))
      throw new Error("Editing requires the accepted plan receipt.");
    const input = await new JsonValueContract().validate({
      task: request.input,
      acceptedPlan: plan.result,
    });
    if (!input.valid) throw new Error("Invalid editing context.");
    return {
      input: input.value,
      instructions: [
        request.assignment.instructions,
        this.workspaceTools.description(false),
        'Final value: {"summary":"what changed","baseSnapshotRef":"from status","resultSnapshotRef":"from status","changedPaths":[],"changeArtifactRefs":[],"unresolved":[]}. Copy actual fields from the CLI response status. The host runs registered checks after each editing CLI call. Use cli with command "true" to refresh status before returning your final result.',
      ].join("\n"),
      tools: this.workspaceTools.bind(false),
      acceptance: {
        apply: async ({ candidate }) => ({
          accepted: await this.workspaceTools.accepts(candidate),
          feedback:
            "Editing must match status and all required checks must pass after the last edit.",
        }),
      },
    };
  }
}
