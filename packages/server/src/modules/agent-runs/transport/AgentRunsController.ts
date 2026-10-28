import type {
  DebugCommandRequest,
  EvaluateRequest,
  SetBreakpointsRequest,
  StartAgentRunRequest,
} from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import { AgentFilePath, AgentName } from "../../agents/public.js";
import type { AgentRunDebugEvents } from "../application/AgentRunDebugEvents.js";
import type { AgentRunService } from "../application/AgentRunService.js";

/** Comments keep idle proxies (Nginx closes after 60 s) from dropping the event stream. */
const KEEP_ALIVE_MS = 15_000;

export class AgentRunsController implements HttpController {
  constructor(
    private readonly runs: AgentRunService,
    private readonly contexts: RequestContextFactory,
    private readonly debugEvents: AgentRunDebugEvents | null = null,
  ) {}

  register(routes: FastifyInstance): void {
    const agentFile = z.string().refine((value) => AgentFilePath.isValid(value), {
      error: "Use a path inside the agent folder.",
    });
    const lines = z.array(z.number().int().min(1).max(1_000_000)).max(200);
    // The same shape kushibot's task contract accepts for file paths.
    const workspaceFile = z
      .string()
      .max(256)
      .regex(/^[A-Za-z0-9_.@/-]+$/)
      .refine((value) => value.split("/").every((part) => !["", ".", ".."].includes(part)), {
        error: "Use a relative path inside the workspace.",
      });
    const params = z.object({ id: z.uuid() });

    routes.post<{ Params: { id: string }; Body: StartAgentRunRequest }>(
      "/projects/:id/agent-runs",
      {
        schema: {
          params,
          body: z
            .object({
              agentName: z.string().regex(AgentName.pattern),
              threadId: z.uuid().optional(),
              message: z.string().trim().min(1).max(8000),
              files: z.array(workspaceFile).max(16),
              debug: z.boolean(),
              breakpoints: z.record(agentFile, lines).optional(),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        reply.code(201).header("Cache-Control", "no-store");
        return this.runs.launch(this.contexts.create(request), request.params.id, request.body);
      },
    );
    routes.get<{ Params: { id: string } }>(
      "/agent-runs/:id",
      { schema: { params } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.runs.find(this.contexts.create(request), request.params.id).dto;
      },
    );
    routes.get<{ Params: { id: string } }>(
      "/agent-runs/:id/events",
      { schema: { params } },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        const lastEventId = Number(request.headers["last-event-id"]);
        reply.hijack();
        const stream = reply.raw;
        stream.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Request-Id": request.id,
        });
        stream.write("retry: 2000\n\n");
        const keepAlive = setInterval(() => stream.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
        const unsubscribe = run.subscribe(Number.isInteger(lastEventId) ? lastEventId : -1, {
          event: ({ seq, event }) =>
            stream.write(`${seq >= 0 ? `id: ${seq}\n` : ""}data: ${JSON.stringify(event)}\n\n`),
          end: () => {
            clearInterval(keepAlive);
            stream.end();
          },
        });
        request.raw.on("close", () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
      },
    );
    routes.get<{ Params: { id: string }; Querystring: { after?: string } }>(
      "/agent-runs/:id/debug-events",
      {
        schema: {
          params,
          querystring: z.object({ after: z.string().max(100_000).optional() }).strict(),
        },
      },
      async (request, reply) => {
        const context = this.contexts.create(request);
        const live = this.runs.findLive(context, request.params.id);
        reply.header("Cache-Control", "no-store");
        if (!this.debugEvents) {
          if (!live) this.runs.find(context, request.params.id);
          return {
            run: { ...live!.dto, status: live!.status },
            recording: false,
            events: [],
            cursor: "",
            more: false,
          };
        }
        return this.debugEvents.read(context, request.params.id, live, request.query.after);
      },
    );
    routes.post<{ Params: { id: string } }>(
      "/agent-runs/:id/cancel",
      { schema: { params } },
      async (request, reply) => {
        this.runs.find(this.contexts.create(request), request.params.id).cancel();
        return reply.code(204).header("Cache-Control", "no-store").send();
      },
    );
    routes.post<{ Params: { id: string }; Body: DebugCommandRequest }>(
      "/agent-runs/:id/debug",
      {
        schema: {
          params,
          body: z
            .object({ command: z.enum(["continue", "pause", "stepOver", "stepInto", "stepOut"]) })
            .strict(),
        },
      },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        await run.debugger.command(request.body.command);
        return reply.code(204).header("Cache-Control", "no-store").send();
      },
    );
    routes.put<{ Params: { id: string }; Body: SetBreakpointsRequest }>(
      "/agent-runs/:id/breakpoints",
      { schema: { params, body: z.object({ file: agentFile, lines }).strict() } },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        reply.header("Cache-Control", "no-store");
        return {
          breakpoints: await run.debugger.setBreakpoints(request.body.file, request.body.lines),
        };
      },
    );
    routes.post<{ Params: { id: string }; Body: EvaluateRequest }>(
      "/agent-runs/:id/evaluate",
      {
        schema: {
          params,
          body: z
            .object({
              expression: z.string().min(1).max(10_000),
              frameId: z.string().max(1000).nullable(),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        reply.header("Cache-Control", "no-store");
        return run.debugger.evaluate(request.body.expression, request.body.frameId);
      },
    );
    routes.get<{ Params: { id: string }; Querystring: { ref: string } }>(
      "/agent-runs/:id/variables",
      { schema: { params, querystring: z.object({ ref: z.string().min(1).max(1000) }) } },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        reply.header("Cache-Control", "no-store");
        return { entries: await run.debugger.variables(request.query.ref), nextOffset: null };
      },
    );
    routes.get<{ Params: { id: string; scriptId: string } }>(
      "/agent-runs/:id/scripts/:scriptId",
      {
        schema: {
          params: z.object({ id: z.uuid(), scriptId: z.string().regex(/^\d{1,10}$/) }),
        },
      },
      async (request, reply) => {
        const run = this.runs.find(this.contexts.create(request), request.params.id);
        reply.header("Cache-Control", "no-store");
        return run.debugger.source(request.params.scriptId);
      },
    );
  }
}
