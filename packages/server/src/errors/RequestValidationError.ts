import { HttpError } from "./HttpError.js";

export type ValidationIssue = Readonly<{ path: string; message: string }>;

export class RequestValidationError extends HttpError {
  constructor(part: string, issues: readonly ValidationIssue[]) {
    super(400, "VALIDATION_FAILED", `Request ${part} is invalid.`, issues);
  }
}
