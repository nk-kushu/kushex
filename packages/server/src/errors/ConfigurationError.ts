import { ApplicationError } from "./ApplicationError.js";

export class ConfigurationError extends ApplicationError {
  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid server configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
  }
}
