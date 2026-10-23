import { ApplicationError } from "./ApplicationError.js";

/** Shutdown did not finish within its deadline; the process must exit forcibly. */
export class ShutdownTimeoutError extends ApplicationError {
  constructor(timeoutMs: number) {
    super(`Shutdown did not complete within ${timeoutMs} ms.`);
  }
}
