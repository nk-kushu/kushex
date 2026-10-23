import type { CreateProjectRequest } from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { ProjectService } from "../application/ProjectService.js";

export class ProjectsController implements HttpController {
  constructor(
    private readonly projects: ProjectService,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    routes.get<{ Params: { id: string } }>(
      "/projects/:id",
      { schema: { params: z.object({ id: z.uuid() }) } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.projects.find(this.contexts.create(request), request.params.id);
      },
    );
    routes.post<{ Body: CreateProjectRequest }>(
      "/projects",
      {
        schema: {
          body: z
            .object({
              name: z.string().trim().min(1).max(200),
              path: z.string().min(1).max(4096),
              description: z.string().trim().max(2000).optional(),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        const project = await this.projects.create(this.contexts.create(request), request.body);
        reply.code(201).header("Cache-Control", "no-store");
        return project;
      },
    );
    routes.get<{ Querystring: { offset: number } }>(
      "/projects",
      {
        schema: {
          querystring: z.object({
            offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
          }),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.projects.list(this.contexts.create(request), request.query.offset);
      },
    );
  }
}
