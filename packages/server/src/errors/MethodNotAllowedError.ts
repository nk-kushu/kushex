import { HttpError } from "./HttpError.js";

export class MethodNotAllowedError extends HttpError {
  constructor(allowed: readonly string[]) {
    super(405, "METHOD_NOT_ALLOWED", "Method not allowed.", undefined, {
      Allow: allowed.join(", "),
    });
  }
}
