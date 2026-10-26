import { ApplicationError } from "./ApplicationError.js";

/** The request is valid but conflicts with the current state, e.g. a stale revision. */
export class ConflictError extends ApplicationError {}
