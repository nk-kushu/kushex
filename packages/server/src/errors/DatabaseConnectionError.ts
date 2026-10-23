import { ApplicationError } from "./ApplicationError.js";

export class DatabaseConnectionError extends ApplicationError {
  constructor(target: string, reason: string, cause: unknown) {
    super(`Could not connect to PostgreSQL at ${target}: ${reason}`, { cause });
  }
}
