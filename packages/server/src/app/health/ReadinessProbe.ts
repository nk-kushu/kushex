import type { Logger } from "../../shared/application/Logger.js";
import type { ReadinessCheck, ReadinessCheckResult } from "./ReadinessCheck.js";

export type ReadinessReport = Readonly<{
  ready: boolean;
  checks: Readonly<Record<string, ReadinessCheckResult>>;
}>;

/** Runs readiness checks concurrently, treating failures and slow checks as not ready. */
export class ReadinessProbe {
  constructor(
    private readonly checks: readonly ReadinessCheck[],
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async report(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.checks.map(async (check) => [check.name, await this.run(check)] as const),
    );
    return {
      ready: results.every(([, result]) => result.ready),
      checks: Object.fromEntries(results),
    };
  }

  private async run(check: ReadinessCheck): Promise<ReadinessCheckResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ReadinessCheckResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ready: false, reason: `Check timed out after ${this.timeoutMs} ms.` }),
        this.timeoutMs,
      );
    });
    try {
      const result = await Promise.race([check.check(), timeout]);
      if (!result.ready) {
        this.logger.warn({ check: check.name, reason: result.reason }, "Readiness check failed.");
      }
      return result;
    } catch (error) {
      this.logger.warn({ check: check.name, err: error }, "Readiness check failed.");
      return { ready: false, reason: "Check failed unexpectedly." };
    } finally {
      clearTimeout(timer);
    }
  }
}
