import type { UpdateAgentCodeNotesRequest } from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { CodeNotesService } from "../application/CodeNotesService.js";
import { AgentName, MAX_AGENT_SOURCE_BYTES } from "../domain/AgentName.js";

export class CodeNotesController implements HttpController {
  constructor(private readonly notes: CodeNotesService) {}

  register(routes: FastifyInstance): void {
    const params = z.object({ name: z.string().regex(AgentName.pattern) });
    routes.get<{ Params: { name: string } }>(
      "/agents/:name/notes",
      { schema: { params } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.notes.find(request.params.name);
      },
    );
    routes.put<{ Params: { name: string }; Body: UpdateAgentCodeNotesRequest }>(
      "/agents/:name/notes",
      {
        bodyLimit: MAX_AGENT_SOURCE_BYTES * 4 + 2048,
        schema: {
          params,
          body: z
            .object({
              content: z.string().max(MAX_AGENT_SOURCE_BYTES),
              baseRevision: z.number().int().min(0),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.notes.save(request.params.name, request.body.content, request.body.baseRevision);
      },
    );
  }
}
