import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { FileService } from "../application/FileService.js";

export class FilesController implements HttpController {
  constructor(
    private readonly files: FileService,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    const params = z.object({ id: z.uuid() });
    routes.get<{ Params: { id: string }; Querystring: { path: string; offset: number } }>(
      "/projects/:id/tree",
      {
        schema: {
          params,
          querystring: z.object({
            path: z.string().max(4096).default(""),
            offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
          }),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.files.tree(
          this.contexts.create(request),
          request.params.id,
          request.query.path,
          request.query.offset,
        );
      },
    );
    routes.get<{ Params: { id: string }; Querystring: { path: string } }>(
      "/projects/:id/file",
      { schema: { params, querystring: z.object({ path: z.string().min(1).max(4096) }) } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.files.file(
          this.contexts.create(request),
          request.params.id,
          request.query.path,
        );
      },
    );
  }
}
