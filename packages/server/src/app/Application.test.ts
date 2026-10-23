import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { ManagedResource } from "../shared/application/ManagedResource.js";
import { Application } from "./Application.js";
import { ShutdownTimeoutError } from "./ProcessCommand.js";

const logger = pino({ level: "silent" });

class RecordingResource implements ManagedResource {
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

describe("Application", () => {
  it("starts in order and stops in reverse order when the stop signal aborts", async () => {
    const events: string[] = [];
    const application = new Application(
      [new RecordingResource("database", events), new RecordingResource("http", events)],
      1000,
      logger,
    );
    const stop = new AbortController();
    const running = application.run(stop.signal);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(["start database", "start http"]);

    stop.abort();
    await running;
    expect(events).toEqual(["start database", "start http", "stop http", "stop database"]);
  });

  it("stops already started resources when a later one fails to start", async () => {
    const events: string[] = [];
    const application = new Application(
      [
        new RecordingResource("database", events),
        new RecordingResource("http", events, { failStart: true }),
      ],
      1000,
      logger,
    );
    await expect(application.run(new AbortController().signal)).rejects.toThrow(
      "http cannot start",
    );
    expect(events).toEqual(["start database", "stop database"]);
  });

  it("stops every resource even when one fails, then reports the failure", async () => {
    const events: string[] = [];
    const application = new Application(
      [
        new RecordingResource("database", events),
        new RecordingResource("http", events, { failStop: true }),
      ],
      1000,
      logger,
    );
    await application.start();
    await expect(application.stop()).rejects.toThrow(AggregateError);
    expect(events).toContain("stop database");
  });

  it("aborts the deadline signal so resources can force cleanup", async () => {
    const events: string[] = [];
    const slow = new RecordingResource("http", events, {
      stop: (deadline) =>
        new Promise((resolve) =>
          deadline.addEventListener("abort", () => resolve(), { once: true }),
        ),
    });
    const application = new Application([slow], 20, logger);
    await application.start();
    await application.stop();
    expect(events).toEqual(["start http", "stop http"]);
  });

  it("fails with a timeout when a resource ignores the deadline", async () => {
    const stuck = new RecordingResource("database", [], { stop: () => new Promise(() => {}) });
    const application = new Application([stuck], 10, logger);
    await application.start();
    await expect(application.stop()).rejects.toBeInstanceOf(ShutdownTimeoutError);
  });
});
