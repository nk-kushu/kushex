import type { ManagedResource } from "../../src/shared/application/ManagedResource.js";

export class RecordingResource implements ManagedResource {
  constructor(
    readonly name: string,
    private readonly events: string[],
    private readonly behavior: {
      failStart?: boolean;
      failStop?: boolean;
      stop?: (deadline: AbortSignal) => Promise<void>;
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.behavior.failStart) {
      throw new Error(`${this.name} cannot start`);
    }
    this.events.push(`start ${this.name}`);
  }

  async stop(deadline: AbortSignal): Promise<void> {
    await this.behavior.stop?.(deadline);
    this.events.push(`stop ${this.name}`);
    if (this.behavior.failStop) {
      throw new Error(`${this.name} cannot stop`);
    }
  }
}
