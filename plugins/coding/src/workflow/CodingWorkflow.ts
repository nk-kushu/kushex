import {
  DefaultAgentAssignmentPolicy,
  EditingResultContract,
  ExecutorRegistration,
  ExecutorRegistry,
  JsonValueContract,
  StepPolicyRegistry,
  StructuredTaskExecutor,
  TaskInputContract,
  WorkspaceEditingExecutor,
  type EditingResult,
  type IAgentTaskFactory,
  type IClock,
  type TaskInput,
  type WorkflowDefinition,
} from "kushibot";
import { CodingInputPolicy } from "./policies/CodingInputPolicy";
import { planningInstructions } from "../steps/planning/instructions";
import { editingInstructions } from "../steps/editing/instructions";

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
      new ExecutorRegistration({
        id: "coding-plan",
        version: "1",
        input: tasks,
        result: tasks,
        executor: new StructuredTaskExecutor({
          input: tasks,
          result: tasks,
          policy: new DefaultAgentAssignmentPolicy(planningInstructions),
          factory: this.planner,
          json,
          clock: this.clock,
        }),
        json,
        clock: this.clock,
      }),
    );

    executors.register(
      new ExecutorRegistration({
        id: "coding-edit",
        version: "1",
        input: tasks,
        result: edits,
        executor: new WorkspaceEditingExecutor(
          tasks,
          edits,
          new DefaultAgentAssignmentPolicy(editingInstructions),
          this.editor,
          json,
          this.clock,
        ),
        json,
        clock: this.clock,
      }),
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
