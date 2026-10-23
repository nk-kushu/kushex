import { ConfigurationError, ServerConfigLoader } from "../config/ServerConfig.js";
import { ApplicationFactory } from "./ApplicationFactory.js";
import { type ProcessCommand, ShutdownTimeoutError } from "./ProcessCommand.js";

/**
 * Adapts a command to the Node.js process: loads configuration, turns SIGINT/SIGTERM into a
 * stop request, and converts failures into log entries and a non-zero exit code.
 * A second signal during shutdown falls through to Node's default handler and exits at once.
 */
export class ProcessHost {
  private static readonly signals = ["SIGINT", "SIGTERM"] as const;

  constructor(
    private readonly process: NodeJS.Process,
    private readonly configLoader = new ServerConfigLoader(),
  ) {}

  async run(createCommand: (factory: ApplicationFactory) => ProcessCommand): Promise<void> {
    let factory: ApplicationFactory;
    try {
      factory = new ApplicationFactory(this.configLoader.load(this.process.env));
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }
      this.process.stderr.write(`${error.message}\n`);
      this.process.exitCode = 1;
      return;
    }

    const stop = new AbortController();
    const requestStop = (signal: NodeJS.Signals) => {
      factory.logger.info({ signal }, "Shutdown requested.");
      stop.abort();
    };
    for (const signal of ProcessHost.signals) {
      this.process.once(signal, requestStop);
    }
    try {
      await createCommand(factory).run(stop.signal);
    } catch (error) {
      factory.logger.error(
        { err: error },
        error instanceof Error ? error.message : "Command failed.",
      );
      this.process.exitCode = 1;
      if (error instanceof ShutdownTimeoutError) {
        this.process.exit();
      }
    } finally {
      for (const signal of ProcessHost.signals) {
        this.process.removeListener(signal, requestStop);
      }
    }
  }
}
