import {
  DefaultAgentAssignmentPolicy,
  EditingResultContract,
  ExecutorRegistration,
  ExecutorRegistry,
  JsonValueContract,
  StepExecutionError,
  StepPolicyRegistry,
  StructuredTaskExecutor,
  TaskInputContract,
  WorkspaceEditingExecutor,
  type EditingResult,
  type IAgentTaskFactory,
  type IClock,
  type IPolicy,
  type JsonValue,
  type StepInputPolicyInput,
  type TaskInput,
  type WorkflowDefinition,
} from "kushibot";
import { editingInstructions, planningInstructions } from "./prompts/instructions";

/** Owns the plan-before-edit dependency and the policies that pass its accepted result. */
export class CodingWorkflow {
  constructor(
    private readonly planner: IAgentTaskFactory<TaskInput>,
    private readonly editor: IAgentTaskFactory<EditingResult>,
    private readonly clock: IClock,
  ) {}

  create() {
    const json = new JsonValueContract();
    const tasks = new TaskInputContract(json);
    const edits = new EditingResultContract(json);
    const executors = new ExecutorRegistry();
    executors.register(
      new ExecutorRegistration(
        "coding-plan",
        "1",
        tasks,
        tasks,
        new StructuredTaskExecutor(
          tasks,
          tasks,
          new DefaultAgentAssignmentPolicy(planningInstructions),
          this.planner,
          json,
          this.clock,
        ),
        json,
        this.clock,
      ),
    );
    executors.register(
      new ExecutorRegistration(
        "coding-edit",
        "1",
        tasks,
        edits,
        new WorkspaceEditingExecutor(
          tasks,
          edits,
          new DefaultAgentAssignmentPolicy(editingInstructions),
          this.editor,
          json,
          this.clock,
        ),
        json,
        this.clock,
      ),
    );

    const policies = new StepPolicyRegistry();
    policies.registerInput(
      { id: "coding-plan-input", version: "1" },
      new CodingInputPolicy(false, tasks, json),
    );
    policies.registerInput(
      { id: "coding-edit-input", version: "1" },
      new CodingInputPolicy(true, tasks, json),
    );
    policies.registerAcceptance(
      { id: "coding-plan-accept", version: "1" },
      {
        async apply({ candidate }) {
          const result = await tasks.validate(candidate);
          return result.valid
            ? { status: "accepted" }
            : {
                status: "rejected",
                code: "INVALID_PLAN",
                message: "A valid implementation plan is required.",
              };
        },
      },
    );
    policies.registerAcceptance(
      { id: "coding-edit-accept", version: "1" },
      {
        async apply({ candidate }) {
          const result = await edits.validate(candidate);
          return result.valid && result.value.unresolved.length === 0
            ? { status: "accepted" }
            : {
                status: "rejected",
                code: "INCOMPLETE_IMPLEMENTATION",
                message: "Implementation is invalid or has unresolved work.",
              };
        },
      },
    );
    const definition: WorkflowDefinition = {
      id: "coding",
      version: "1",
      maxTotalAttempts: 4,
      transitions: [],
      steps: [
        {
          id: "plan",
          dependencies: [],
          executor: executors.resolve("coding-plan", "1").metadata,
          inputPolicy: { id: "coding-plan-input", version: "1" },
          acceptancePolicy: { id: "coding-plan-accept", version: "1" },
          maxAttempts: 2,
        },
        {
          id: "edit",
          dependencies: ["plan"],
          executor: executors.resolve("coding-edit", "1").metadata,
          inputPolicy: { id: "coding-edit-input", version: "1" },
          acceptancePolicy: { id: "coding-edit-accept", version: "1" },
          maxAttempts: 2,
        },
      ],
    };
    return { definition, executors, policies };
  }
}

class CodingInputPolicy implements IPolicy<StepInputPolicyInput, JsonValue> {
  constructor(
    private readonly requiresPlan: boolean,
    private readonly tasks: TaskInputContract,
    private readonly json: JsonValueContract,
  ) {}

  async apply(view: StepInputPolicyInput): Promise<JsonValue> {
    const request = await this.tasks.validate(view.request);
    if (!request.valid) throw new StepExecutionError();
    if (!this.requiresPlan) return this.asJson(request.value);
    const accepted = view.dependencies.find((item) => item.stepId === "plan");
    if (!accepted) throw new StepExecutionError();
    const plan = await this.tasks.validate(accepted.result);
    if (!plan.valid) throw new StepExecutionError();
    // Keep original authorization and requirements authoritative; the plan is guidance.
    return this.asJson({
      ...request.value,
      goal: request.value.goal,
      sourceRefs: [...new Set([...request.value.sourceRefs, accepted.receiptRef])],
    });
  }

  private async asJson(value: TaskInput): Promise<JsonValue> {
    const task = await this.tasks.validate(value);
    if (!task.valid) throw new StepExecutionError();
    const result = await this.json.validate(task.value);
    if (!result.valid) throw new StepExecutionError();
    return result.value;
  }
}
