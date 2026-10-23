import { ApplicationError } from "./ApplicationError.js";

export type ApiErrorBody = Readonly<{
  code: string;
  message: string;
  details?: readonly unknown[];
}>;

/** An error raised by transport code that already knows its HTTP response. */
export class HttpError extends ApplicationError {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: readonly unknown[],
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}
