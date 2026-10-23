import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifySchemaCompiler,
} from "fastify";
import type { ZodType } from "zod";
import type { ManagedResource } from "../../shared/application/ManagedResource.js";
import type { ErrorResponder } from "./ErrorResponder.js";
import type { HttpController } from "./HttpController.js";
import { RequestValidationError } from "./HttpError.js";

export type HttpServerOptions = Readonly<{ host: string; port: number }>;

/**
 * Owns the Fastify instance: route registration, Zod request validation, consistent error
 * responses, and the listening lifecycle. Route schemas (`body`, `querystring`, `params`,
 * `headers`) are Zod schemas; the parsed value replaces the raw request part.
 */
export class HttpServer implements ManagedResource {
  readonly name = "http";
  private readonly app: FastifyInstance;

  constructor(
    private readonly options: HttpServerOptions,
    logger: FastifyBaseLogger,
    errorResponder: ErrorResponder,
    controllers: readonly HttpController[],
  ) {
    this.app = fastify({
      loggerInstance: logger,
      logController: new LogController({ disableRequestLogging: true }),
      genReqId: () => randomUUID(),
    });
    this.app.setValidatorCompiler<ZodType>((route) => this.compileValidator(route));
    this.app.setErrorHandler((error, request, reply) =>
      errorResponder.respond(error, request, reply),
    );
    this.app.setNotFoundHandler((request, reply) => errorResponder.respondNotFound(request, reply));
    this.app.addHook("onRequest", async (request, reply) => {
      reply.header("X-Request-Id", request.id);
    });
    for (const controller of controllers) {
      controller.register(this.app);
    }
  }

  /** The bound port; useful when listening on port 0. */
  get port(): number {
    return (this.app.server.address() as AddressInfo).port;
  }

  async start(): Promise<void> {
    await this.app.listen({ host: this.options.host, port: this.options.port });
  }

  /** Stops accepting connections and waits for in-flight requests until the deadline. */
  async stop(deadline: AbortSignal): Promise<void> {
    const forceClose = () => this.app.server.closeAllConnections();
    if (deadline.aborted) {
      forceClose();
    }
    deadline.addEventListener("abort", forceClose, { once: true });
    try {
      await this.app.close();
    } finally {
      deadline.removeEventListener("abort", forceClose);
    }
  }

  private compileValidator({
    schema,
    httpPart,
  }: Parameters<FastifySchemaCompiler<ZodType>>[0]): ReturnType<FastifySchemaCompiler<ZodType>> {
    return (data: unknown) => {
      const result = schema.safeParse(data);
      if (result.success) {
        return { value: result.data };
      }
      return {
        error: new RequestValidationError(
          httpPart ?? "data",
          result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      };
    };
  }
}
