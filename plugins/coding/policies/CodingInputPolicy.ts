import {
  StepExecutionError,
  type TaskInputContract,
  type JsonValueContract,
  type IPolicy,
  type JsonValue,
  type StepInputPolicyInput,
  type TaskInput,
} from "kushibot";

/**
 * Prepares and validates task input before a coding workflow step runs.
 */
export class CodingInputPolicy implements IPolicy<StepInputPolicyInput, JsonValue> {
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
