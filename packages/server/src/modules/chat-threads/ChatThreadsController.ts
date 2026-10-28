import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import type { ChatThreads } from "./ChatThreads.js";

export class ChatThreadsController implements HttpController {
  constructor(
    private readonly threads: ChatThreads,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    const project = z.object({ projectId: z.uuid() });
    const thread = z.object({ projectId: z.uuid(), id: z.uuid() });
    routes.get<{ Params: { projectId: string } }>(
      "/projects/:projectId/chat-threads",
      { schema: { params: project } },
      async (req) => this.threads.list(this.contexts.create(req), req.params.projectId),
    );
    routes.post<{ Params: { projectId: string } }>(
      "/projects/:projectId/chat-threads",
      { schema: { params: project } },
      async (req, reply) => {
        reply.code(201);
        return this.threads.create(this.contexts.create(req), req.params.projectId);
      },
    );
    routes.get<{ Params: { projectId: string; id: string } }>(
      "/projects/:projectId/chat-threads/:id",
      { schema: { params: thread } },
      async (req) =>
        this.threads.get(this.contexts.create(req), req.params.projectId, req.params.id),
    );
    routes.delete<{ Params: { projectId: string; id: string } }>(
      "/projects/:projectId/chat-threads/:id",
      { schema: { params: thread } },
      async (req, reply) => {
        await this.threads.delete(this.contexts.create(req), req.params.projectId, req.params.id);
        return reply.code(204).send();
      },
    );
    routes.delete<{ Params: { projectId: string } }>(
      "/projects/:projectId/chat-threads",
      { schema: { params: project } },
      async (req, reply) => {
        await this.threads.delete(this.contexts.create(req), req.params.projectId);
        return reply.code(204).send();
      },
    );
  }
}
