/** Structured logging contract; the composition root supplies the concrete logger. */
export interface Logger {
  debug(context: object, message: string): void;
  info(context: object, message: string): void;
  warn(context: object, message: string): void;
  error(context: object, message: string): void;
}
