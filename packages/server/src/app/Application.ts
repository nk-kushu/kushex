import type { Logger } from "../shared/application/Logger.js";
import type { ManagedResource } from "../shared/application/ManagedResource.js";
import { type ProcessCommand, ShutdownTimeoutError } from "./ProcessCommand.js";

/** Grace period after the deadline aborts, for resources to finish forced cleanup. */
const FORCED_STOP_GRACE_MS = 2000;

/**
 * Starts resources in order, serves until asked to stop, then stops them in reverse order.
 * A failed start stops whatever already started before reporting the failure.
 */
export class Application implements ProcessCommand {
  private readonly started: ManagedResource[] = [];

  constructor(
    private readonly resources: readonly ManagedResource[],
    private readonly shutdownTimeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async run(stop: AbortSignal): Promise<void> {
    await this.start();
    if (!stop.aborted) {
      await new Promise<void>((resolve) =>
        stop.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
    await this.stop();
  }

  async start(): Promise<void> {
    for (const resource of this.resources) {
      try {
        await resource.start();
      } catch (error) {
        await this.stop().catch((stopError: unknown) => {
          this.logger.error({ err: stopError }, "Cleanup after failed startup also failed.");
        });
        throw error;
      }
      this.started.push(resource);
    }
    this.logger.info({}, "Kushex server started.");
  }

  async stop(): Promise<void> {
    const deadline = new AbortController();
    const timers: NodeJS.Timeout[] = [];
    const expired = new Promise<never>((_resolve, reject) => {
      timers.push(setTimeout(() => deadline.abort(), this.shutdownTimeoutMs));
      timers.push(
        setTimeout(
          () => reject(new ShutdownTimeoutError(this.shutdownTimeoutMs)),
          this.shutdownTimeoutMs + FORCED_STOP_GRACE_MS,
        ),
      );
    });
    try {
      await Promise.race([this.stopStarted(deadline.signal), expired]);
    } finally {
      timers.forEach(clearTimeout);
    }
  }

  private async stopStarted(deadline: AbortSignal): Promise<void> {
    const failures: unknown[] = [];
    for (let resource = this.started.pop(); resource; resource = this.started.pop()) {
      try {
        await resource.stop(deadline);
        this.logger.info({ resource: resource.name }, "Stopped resource.");
      } catch (error) {
        failures.push(error);
        this.logger.error({ err: error, resource: resource.name }, "Failed to stop resource.");
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more resources failed to stop.");
    }
  }
}
