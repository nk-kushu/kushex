import type { ReadinessCheck, ReadinessCheckResult } from "../../src/app/health/ReadinessCheck.js";

export class StubCheck implements ReadinessCheck {
  constructor(
    readonly name: string,
    private readonly result: ReadinessCheckResult,
  ) {}

  async check(): Promise<ReadinessCheckResult> {
    return this.result;
  }
}
