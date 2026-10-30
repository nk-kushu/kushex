import {
  EditingResultContract,
  JsonValueContract,
  SessionAgentTaskFactory,
  TaskInputContract,
  WorkflowPolicyRegistry,
  type AgentRunRuntime,
  type AgentTaskBindingRequest,
  type IAgentSessionBinding,
  type IAgentSetupInput,
  type IArtifactWriter,
  type IAgentTaskFactory,
  type IAgentWorkflow,
  type EditingResult,
  type IModelGateway,
  type IPolicy,
  type IResultContract,
  type ModelProfile,
  type TaskInput,
} from "kushibot";
import type { CodingAgentOptions, CodingCheck } from "../CodingAgentOptions";
import { CompressingCodingSessions } from "../context/CompressingCodingSessions";
import { CodingWorkflow } from "./CodingWorkflow";
import { EditingSessionPolicy } from "../steps/editing/EditingSessionPolicy";
import { PlanningSessionPolicy } from "../steps/planning/PlanningSessionPolicy";
import { WorkspaceTools } from "../tools/WorkspaceTools";

/**
 * **This class prepares everything the agent needs to do a coding task.**
 *
 * Imagine you ask: “Fix the login button.”
 *
 * `CodingRunWorkflow` sets up:
 *
 * 1. **Tools** — which files the agent can read and edit.
 * 2. **Steps** — first make a plan, then edit the code.
 * 3. **Checks** — verify that the reported changes match the actual files and that configured checks passed.
 * 4. **Result** — choose what to return when the work finishes.
 *
 * **Why does it exist?** The underlying `Agent` is general-purpose. This class supplies the setup that makes it behave like a **coding agent**.
 *
 * `apply()` means: **“Prepare this particular task for execution.”**
 *
 * Think of it as preparing a kitchen: tools, recipe, and rules. The workflow engine then does the cooking.
 */
export class CodingRunWorkflow implements IPolicy<
  IAgentSetupInput<TaskInput>,
  IAgentWorkflow<EditingResult>
> {
  private readonly checks: readonly CodingCheck[];
  constructor(
    private readonly workspace: string,
    private readonly artifacts: IArtifactWriter,
    checks: readonly CodingCheck[] = [],
    /**
     * Only needed to build compressing sessions. `AgentRunRuntime` keeps its gateway and
     * profile private, so the composition root threads them through rather than the runtime
     * handing them over.
     */
    private readonly model: Readonly<{
      gateway: IModelGateway;
      profile: ModelProfile;
      modelTimeoutMs: number;
    }> | null = null,
    private readonly compression: CodingAgentOptions["compression"] = undefined,
  ) {
    if (
      checks.length > 16 ||
      new Set(checks.map((check) => check.id)).size !== checks.length ||
      checks.some((check) => !/^[A-Za-z0-9_.:-]{1,128}$/.test(check.id) || !check.command)
    )
      throw new Error("Invalid check registrations.");
    this.checks = checks.map((check) =>
      Object.freeze({ ...check, args: Object.freeze([...check.args]) }),
    );
  }
  /**
   * Prepares one coding run; called by Kushibot's Agent during `agent.run(task)`.
   * - Receives the validated task and a fresh runtime (stores, budget, sessions).
   * - Initializes workspace tools restricted to the task's permitted files.
   * - Returns the plan → edit workflow, validation policies, and result mapping.
   *
   * The workflow engine executes the returned setup. `apply` is the IPolicy method.
   */
  async apply({
    task,
    runtime,
  }: IAgentSetupInput<TaskInput>): Promise<IAgentWorkflow<EditingResult>> {
    // An empty filePaths list enables workspace access; explicit paths restrict it.
    // This local runner cannot fetch external references; reject them instead of
    // silently ignoring context the caller expects the agent to use.
    if (task.sourceRefs.length !== 0)
      throw new Error(
        "External source references are not supported by the local runner. Supply context through permitted files.",
      );

    // Create tools per run so file snapshots, edits, and check results cannot leak
    // between tasks. Use the runtime's budget and clock to share its run limits.
    const tools = new WorkspaceTools(
      this.workspace,
      task.filePaths,
      this.checks,
      runtime,
      this.artifacts,
    );

    // Capture the original files before planning: completion compares against
    // this baseline to verify which files actually changed.
    await tools.initialize();

    // Planning returns a TaskInput-shaped plan; editing returns an EditingResult.
    // Contracts validate these model outputs before the workflow can accept them.
    const json = new JsonValueContract(),
      taskContract = new TaskInputContract(json),
      editingResultContract = new EditingResultContract(json);

    // Bind both sessions to the same workspace evidence. Planning gets read-only
    // tools; editing gets the accepted plan plus write/check tools. The workflow
    // declares the plan → edit dependency; no model calls happen during setup.
    //
    // Each step gets its own session, so each gets its own context ledger: planning
    // observations can never be compressed into the editing context.
    const workflow = new CodingWorkflow(
      this.taskFactory(runtime, taskContract, new PlanningSessionPolicy(runtime, tools)),
      this.taskFactory(runtime, editingResultContract, new EditingSessionPolicy(runtime, tools)),
      runtime.clock,
    ).create();

    // The workflow refers to this policy by ID/version; the registry supplies
    // the callback the engine invokes before declaring the whole run complete.
    const completionPolicy = { id: "coding-complete", version: "1" };
    const workflowPolicies = new WorkflowPolicyRegistry();

    workflowPolicies.registerCompletion(completionPolicy, {
      apply: async ({ run }) => {
        // Recheck the accepted edit against current files and required checks.
        // A valid result shape alone cannot prove the reported work was done.
        const result = await editingResultContract.validate(
          run.accepted.find((item) => item.stepId === "edit")?.result,
        );

        return result.valid && (await tools.accepts(result.value))
          ? { accepted: true }
          : {
              accepted: false,
              code: "CODING_EVIDENCE_MISMATCH",
              message:
                "Current files and required check results must match the accepted implementation.",
            };
      },
    });

    // Return configuration and callbacks to Agent; it registers the workflow,
    // starts the engine, then maps the result and collects artifacts afterward.
    return {
      ...workflow,
      completionPolicy,
      workflowPolicies,
      evidence: {
        // Only plan dependencies are supported here, and editing must have one.
        // This rejects an edit context that omits the prerequisite planning step.
        apply: async ({ view }) =>
          view.dependencies.every((dependency) => dependency.stepId === "plan") &&
          (view.stepId !== "edit" ||
            view.dependencies.some((dependency) => dependency.stepId === "plan")),
      },
      resultPolicy: {
        // The engine returns results for all steps. Expose only the accepted edit
        // as the caller's EditingResult, failing if it is missing or malformed.
        apply: async (result) => {
          const checked = await editingResultContract.validate(
            result.results.find((item) => item.stepId === "edit")?.result,
          );
          if (!checked.valid) throw new Error("Accepted coding result is missing.");
          return checked.value;
        },
      },
      // Agent validates the mapped public result with this contract too.
      resultContract: editingResultContract,
      // Return store references; payloads live in the host-configured artifact store.
      artifacts: () => tools.evidence(),
    };
  }

  /**
   * Build one step's session factory.
   *
   * `runtime.createTaskFactory` is the normal path and hardcodes `AgentModelTurn`. When
   * compression is enabled we assemble the same `SessionAgentTaskFactory` by hand around a
   * provider that builds a compressing turn instead. Both paths share the run's ids and debug
   * recorder, so the two look identical in the trace apart from the context events.
   */
  private taskFactory<TResult>(
    runtime: AgentRunRuntime,
    result: IResultContract<TResult>,
    bindings: IPolicy<AgentTaskBindingRequest, IAgentSessionBinding<TResult>>,
  ): IAgentTaskFactory<TResult> {
    if (!this.compression?.enabled || !this.model)
      return runtime.createTaskFactory(result, bindings);

    const { enabled: _enabled, ...settings } = this.compression;
    return new SessionAgentTaskFactory(
      new CompressingCodingSessions(
        runtime,
        bindings,
        this.model.gateway,
        this.model.profile,
        this.artifacts,
        this.model.modelTimeoutMs,
        settings,
      ),
      result,
      runtime.ids,
      runtime.debug,
    );
  }
}
