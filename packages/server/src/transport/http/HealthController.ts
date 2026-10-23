import type { FastifyInstance, FastifyReply } from "fastify";
import type { ReadinessProbe } from "../../app/health/ReadinessProbe.js";
import type { HttpController } from "./HttpController.js";
import { MethodNotAllowedError } from "./HttpError.js";

/**
 * `GET /health` is liveness: the process serves HTTP, independent of dependencies.
 * `GET /health/ready` is readiness: dependencies are reachable and the schema is current.
 */
export class HealthController implements HttpController {
  constructor(private readonly readiness: ReadinessProbe) {}

  register(routes: FastifyInstance): void {
    routes.get("/health", async (_request, reply) => {
      this.disableCaching(reply);
      return { status: "ok" };
    });
    routes.get("/health/ready", async (_request, reply) => {
      this.disableCaching(reply);
      const report = await this.readiness.report();
      reply.code(report.ready ? 200 : 503);
      return { status: report.ready ? "ready" : "not_ready", checks: report.checks };
    });
    for (const url of ["/health", "/health/ready"]) {
      routes.route({
        method: ["POST", "PUT", "PATCH", "DELETE"],
        url,
        handler: async () => {
          throw new MethodNotAllowedError(["GET", "HEAD"]);
        },
      });
    }
  }

  private disableCaching(reply: FastifyReply): void {
    reply.header("Cache-Control", "no-store");
  }
}
