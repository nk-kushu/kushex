/** A unit of work run by an executable entry point until it completes or `stop` aborts. */
export interface ProcessCommand {
  run(stop: AbortSignal): Promise<void>;
}
