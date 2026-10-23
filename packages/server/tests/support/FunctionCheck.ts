import type { ReadinessCheck, ReadinessCheckResult } from "../../src/app/health/ReadinessCheck.js";

export class FunctionCheck implements ReadinessCheck {
  constructor(
    readonly name: string,
    private readonly behavior: () => Promise<ReadinessCheckResult>,
  ) {}

  check(): Promise<ReadinessCheckResult> {
    return this.behavior();
  }
}
