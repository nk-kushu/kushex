import { NotFoundError } from "../../errors/NotFoundError.js";
import { ForbiddenError } from "../../errors/ForbiddenError.js";
import { PayloadTooLargeError } from "../../errors/PayloadTooLargeError.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../shared/application/Logger.js";
import { type ApiErrorBody, HttpError } from "../../errors/HttpError.js";

/** Maps every failure to the API's `{ code, message, details? }` error body. */
export class ErrorResponder {
  private static readonly clientErrorCodes: Readonly<Record<number, string>> = {
    400: "BAD_REQUEST",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    406: "NOT_ACCEPTABLE",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
  };

  constructor(private readonly logger: Logger) {}

  respond(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    reply.header("Cache-Control", "no-store");
    if (error instanceof NotFoundError)
      return this.send(reply, 404, { code: "NOT_FOUND", message: error.message });
    if (error instanceof ForbiddenError)
      return this.send(reply, 403, { code: "FORBIDDEN", message: error.message });
    if (error instanceof PayloadTooLargeError)
      return this.send(reply, 413, {
        code: "PAYLOAD_TOO_LARGE",
        message: error.message,
        details: [{ size: error.size, maxBytes: error.maxBytes }],
      });
    if (error instanceof HttpError) {
      return this.send(reply, error.statusCode, error.toBody(), error.headers);
    }
    const clientStatus = this.clientStatusOf(error);
    if (clientStatus !== undefined && error instanceof Error) {
      // Fastify's own request errors (malformed JSON, size limits, media types) are safe to show.
      return this.send(reply, clientStatus, {
        code: ErrorResponder.clientErrorCodes[clientStatus] ?? "BAD_REQUEST",
        message: error.message,
      });
    }
    this.logger.error(
      { err: error, requestId: request.id, method: request.method, url: request.url },
      "Unhandled request error.",
    );
    return this.send(reply, 500, {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  }

  respondNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    return this.send(reply, 404, {
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url.split("?")[0]} not found.`,
    });
  }

  private send(
    reply: FastifyReply,
    statusCode: number,
    body: ApiErrorBody,
    headers: Readonly<Record<string, string>> = {},
  ): FastifyReply {
    return reply
      .code(statusCode)
      .headers(headers)
      .type("application/json; charset=utf-8")
      .send(body);
  }

  private clientStatusOf(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("statusCode" in error)) {
      return undefined;
    }
    const { statusCode } = error;
    return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
      ? statusCode
      : undefined;
  }
}
