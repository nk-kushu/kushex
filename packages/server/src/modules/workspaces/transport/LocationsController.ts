import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { WorkspaceService } from "../application/WorkspaceService.js";

export class LocationsController implements HttpController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    routes.get<{ Querystring: { offset: number } }>(
      "/locations",
      {
        schema: {
          querystring: z.object({
            offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
          }),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.workspaces.locations(this.contexts.create(request), request.query.offset);
      },
    );
  }
}
