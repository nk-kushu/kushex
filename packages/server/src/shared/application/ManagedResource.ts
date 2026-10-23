/**
 * A resource whose lifecycle the application owns. `stop` receives a signal that aborts when
 * the shutdown deadline passes; implementations should then release resources forcefully.
 */
export interface ManagedResource {
  readonly name: string;
  start(): Promise<void>;
  stop(deadline: AbortSignal): Promise<void>;
}
