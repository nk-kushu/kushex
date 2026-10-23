import { ApplicationError } from "./ApplicationError.js";

export class PayloadTooLargeError extends ApplicationError {
  constructor(
    readonly size: number,
    readonly maxBytes: number,
  ) {
    super(`File exceeds the ${maxBytes} byte preview limit.`);
  }
}
