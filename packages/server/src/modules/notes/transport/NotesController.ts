import type { CreateNoteRequest, UpdateNoteRequest } from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { NoteService } from "../application/NoteService.js";
import { MAX_NOTE_CONTENT_LENGTH } from "../domain/NoteTitle.js";

export class NotesController implements HttpController {
  constructor(
    private readonly notes: NoteService,
    private readonly contexts: RequestContextFactory,
  ) {}

  register(routes: FastifyInstance): void {
    const params = z.object({ id: z.uuid() });
    const content = z.string().max(MAX_NOTE_CONTENT_LENGTH);
    // UTF-8 and JSON escaping can make the body several times the content's length.
    const bodyLimit = MAX_NOTE_CONTENT_LENGTH * 4 + 2048;
    routes.get<{ Querystring: { query?: string } }>(
      "/notes",
      { schema: { querystring: z.object({ query: z.string().trim().max(200).optional() }) } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.notes.list(this.contexts.create(request), request.query.query || null);
      },
    );
    routes.post<{ Body: CreateNoteRequest }>(
      "/notes",
      { bodyLimit, schema: { body: z.object({ content: content.optional() }).strict() } },
      async (request, reply) => {
        const note = await this.notes.create(
          this.contexts.create(request),
          request.body.content ?? "",
        );
        reply.code(201).header("Cache-Control", "no-store");
        return note;
      },
    );
    routes.get<{ Params: { id: string } }>(
      "/notes/:id",
      { schema: { params } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.notes.find(this.contexts.create(request), request.params.id);
      },
    );
    routes.patch<{ Params: { id: string }; Body: UpdateNoteRequest }>(
      "/notes/:id",
      {
        bodyLimit,
        schema: {
          params,
          body: z
            .object({
              pinned: z.boolean().optional(),
              content: content.optional(),
              baseRevision: z.number().int().min(1).optional(),
            })
            .strict()
            .refine((input) => (input.content === undefined) === (input.baseRevision === undefined), {
              message: "Content and baseRevision go together.",
            })
            .refine((input) => input.pinned !== undefined || input.content !== undefined, {
              message: "Nothing to update.",
            }),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.notes.update(this.contexts.create(request), request.params.id, request.body);
      },
    );
    routes.delete<{ Params: { id: string } }>(
      "/notes/:id",
      { schema: { params } },
      async (request, reply) => {
        await this.notes.delete(this.contexts.create(request), request.params.id);
        return reply.code(204).send();
      },
    );
  }
}
