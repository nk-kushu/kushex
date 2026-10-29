import {
  EditingResultContract,
  FilesystemWorkingCopy,
  JsonValueContract,
  TaskInputContract,
  WorkflowPolicyRegistry,
  type IAgentSetupInput,
  type IArtifactWriter,
  type IAgentWorkflow,
  type EditingResult,
  type IPolicy,
  type TaskInput,
} from "kushibot";
import type { CodingCheck } from "../CodingAgentOptions";
import { CodingWorkflow } from "./CodingWorkflow";
import { EditingSessionPolicy } from "../policies/EditingSessionPolicy";
import { PlanningSessionPolicy } from "../policies/PlanningSessionPolicy";
import { WorkspaceTools } from "../WorkspaceTools";

/**
 * **This class prepares everything the agent needs to do a coding task.**
 *
 * Imagine you ask: “Fix the login button.”
 *
 * `AgentWorkflow` sets up:
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
export class AgentWorkflow implements IPolicy<
  IAgentSetupInput<TaskInput>,
  IAgentWorkflow<EditingResult>
> {
  private readonly checks: readonly CodingCheck[];
  constructor(
    private readonly workspace: string,
    private readonly artifacts: IArtifactWriter,
    checks: readonly CodingCheck[] = [],
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
    const workingCopy = await new FilesystemWorkingCopy().create(this.workspace);
    const tools = new WorkspaceTools(
      workingCopy,
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
      tasks = new TaskInputContract(json),
      edits = new EditingResultContract(json);

    // Bind both sessions to the same workspace evidence. Planning gets read-only
    // tools; editing gets the accepted plan plus write/check tools. The workflow
    // declares the plan → edit dependency; no model calls happen during setup.
    const workflow = new CodingWorkflow(
      runtime.createTaskFactory(tasks, new PlanningSessionPolicy(runtime, tools)),
      runtime.createTaskFactory(edits, new EditingSessionPolicy(runtime, tools)),
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
        const result = await edits.validate(
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
          const checked = await edits.validate(
            result.results.find((item) => item.stepId === "edit")?.result,
          );
          if (!checked.valid) throw new Error("Accepted coding result is missing.");
          return checked.value;
        },
      },
      // Agent validates the mapped public result with this contract too.
      resultContract: edits,
      // Return store references; payloads live in the host-configured artifact store.
      artifacts: () => ({ ...tools.evidence(), workingCopy }),
    };
  }
}
