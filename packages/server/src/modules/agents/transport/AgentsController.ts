import type {
  CreateAgentFileRequest,
  CreateAgentRequest,
  UpdateAgentFileRequest,
} from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { AgentService } from "../application/AgentService.js";
import { AgentFilePath } from "../domain/AgentFilePath.js";
import { AgentName, MAX_AGENT_SOURCE_BYTES } from "../domain/AgentName.js";

export class AgentsController implements HttpController {
  constructor(private readonly agents: AgentService) {}

  register(routes: FastifyInstance): void {
    const name = z.string().regex(AgentName.pattern, {
      error: "Use lowercase letters, digits and dashes, starting with a letter.",
    });
    const filePath = z.string().refine((value) => AgentFilePath.isValid(value), {
      error:
        "Use a path inside the agent folder: letters, digits, '.', '_' and '-', no segment starting with a dot.",
    });
    const params = z.object({ name });
    routes.get("/agents", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return { entries: await this.agents.list(), nextOffset: null };
    });
    routes.post<{ Body: CreateAgentRequest }>(
      "/agents",
      { schema: { body: z.object({ name }).strict() } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store").code(201);
        return this.agents.create(request.body.name);
      },
    );
    routes.get<{ Params: { name: string } }>(
      "/agents/:name",
      { schema: { params } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.agents.find(request.params.name);
      },
    );
    routes.post<{ Params: { name: string }; Body: CreateAgentFileRequest }>(
      "/agents/:name/files",
      { schema: { params, body: z.object({ path: filePath }).strict() } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store").code(201);
        return this.agents.createFile(request.params.name, request.body.path);
      },
    );
    routes.put<{ Params: { name: string }; Body: UpdateAgentFileRequest }>(
      "/agents/:name/files",
      {
        // Characters, not bytes; the store enforces the byte limit after encoding.
        bodyLimit: MAX_AGENT_SOURCE_BYTES * 4 + 2048,
        schema: {
          params,
          body: z
            .object({
              path: filePath,
              content: z.string().max(MAX_AGENT_SOURCE_BYTES),
              baseRevision: z.string().regex(/^[0-9a-f]{64}$/),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.agents.updateFile(
          request.params.name,
          request.body.path,
          request.body.content,
          request.body.baseRevision,
        );
      },
    );
    routes.get("/kushibot/types", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.agents.types();
    });
  }
}
