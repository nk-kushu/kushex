/** A unit of work run by an executable entry point until it completes or `stop` aborts. */
export interface ProcessCommand {
  run(stop: AbortSignal): Promise<void>;
}

/** Shutdown did not finish within its deadline; the process must exit forcibly. */
export class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Shutdown did not complete within ${timeoutMs} ms.`);
    this.name = "ShutdownTimeoutError";
  }
}
