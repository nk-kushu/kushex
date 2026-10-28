import {
  JsonValueContract,
  type AgentRunRuntime,
  type IAgentSessionBinding,
  type AgentTaskBindingRequest,
  type EditingResult,
  type IPolicy,
} from "kushibot";
import type { WorkspaceTools } from "../WorkspaceTools";

/** Binds the accepted plan, editing tools, and implementation acceptance policy. */
export class EditingSessionPolicy implements IPolicy<
  AgentTaskBindingRequest,
  IAgentSessionBinding<EditingResult>
> {
  
  constructor(
    private readonly runtime: AgentRunRuntime,
    private readonly workspace: WorkspaceTools,
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
        this.workspace.description(false),
        'Final value: {"summary":"what changed","baseSnapshotRef":"from status","resultSnapshotRef":"from status","changedPaths":[],"changeArtifactRefs":[],"unresolved":[]}. Copy actual fields from status. Run all registered checks after the last write.',
      ].join("\n"),
      tools: this.workspace.bind(false),
      acceptance: {
        apply: async ({ candidate }) => ({
          accepted: await this.workspace.accepts(candidate),
          feedback:
            "Editing must match status and all required checks must pass after the last edit.",
        }),
      },
    };
  }
}
