import {
  EditingResultContract,
  JsonValueContract,
  TaskInputContract,
  WorkflowPolicyRegistry,
  type IAgentSetupInput,
  type IAgentWorkflow,
  type EditingResult,
  type IPolicy,
  type TaskInput,
} from "kushibot";
import type { CodingCheck } from "./CodingAgentOptions";
import { CodingWorkflow } from "./CodingWorkflow";
import { EditingSessionPolicy, PlanningSessionPolicy } from "./CodingSessions";
import { WorkspaceTools } from "./WorkspaceTools";

/** Application-owned plan/edit behavior; no engine, model loop, or stores are implemented here. */
export class CodingAgentDefinition implements IPolicy<
  IAgentSetupInput<TaskInput>,
  IAgentWorkflow<EditingResult>
> {
  private readonly checks: readonly CodingCheck[];
  constructor(
    private readonly workspace: string,
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
  async apply({
    task,
    runtime,
  }: IAgentSetupInput<TaskInput>): Promise<IAgentWorkflow<EditingResult>> {
    if (task.filePaths.length === 0) throw new Error("Provide explicit file paths.");
    if (task.sourceRefs.length !== 0)
      throw new Error(
        "External source references are not supported by the local runner. Supply context through permitted files.",
      );
    const tools = new WorkspaceTools(
      this.workspace,
      task.filePaths,
      this.checks,
      runtime.stores.usage,
      runtime.budgetScopeId,
      runtime.clock,
    );
    await tools.initialize();
    const json = new JsonValueContract(),
      tasks = new TaskInputContract(json),
      edits = new EditingResultContract(json);
    const workflow = new CodingWorkflow(
      runtime.createTaskFactory(tasks, new PlanningSessionPolicy(runtime, tools)),
      runtime.createTaskFactory(edits, new EditingSessionPolicy(runtime, tools)),
      runtime.clock,
    ).create();
    const completionPolicy = { id: "coding-complete", version: "1" };
    const workflowPolicies = new WorkflowPolicyRegistry();
    workflowPolicies.registerCompletion(completionPolicy, {
      apply: async ({ run }) => {
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
    return {
      ...workflow,
      completionPolicy,
      workflowPolicies,
      evidence: {
        apply: async ({ view }) =>
          view.dependencies.every((dependency) => dependency.stepId === "plan") &&
          (view.stepId !== "edit" ||
            view.dependencies.some((dependency) => dependency.stepId === "plan")),
      },
      resultPolicy: {
        apply: async (result) => {
          const checked = await edits.validate(
            result.results.find((item) => item.stepId === "edit")?.result,
          );
          if (!checked.valid) throw new Error("Accepted coding result is missing.");
          return checked.value;
        },
      },
      resultContract: edits,
      artifacts: () => tools.evidence(),
    };
  }
}
