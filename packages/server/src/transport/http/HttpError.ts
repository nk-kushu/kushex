export type ApiErrorBody = Readonly<{
  code: string;
  message: string;
  details?: readonly unknown[];
}>;

/** An error raised by transport code that already knows its HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: readonly unknown[],
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }

  toBody(): ApiErrorBody {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export type ValidationIssue = Readonly<{ path: string; message: string }>;

export class RequestValidationError extends HttpError {
  constructor(part: string, issues: readonly ValidationIssue[]) {
    super(400, "VALIDATION_FAILED", `Request ${part} is invalid.`, issues);
    this.name = "RequestValidationError";
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(allowed: readonly string[]) {
    super(405, "METHOD_NOT_ALLOWED", "Method not allowed.", undefined, {
      Allow: allowed.join(", "),
    });
    this.name = "MethodNotAllowedError";
  }
}
