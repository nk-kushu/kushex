import { ConflictError } from "../../errors/ConflictError.js";
import { CodingRunEvidence } from "./CodingRunEvidence.js";
import type { AgentRunEventDto, StartAgentRunRequest } from "@kushex/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import type { ProjectService } from "../projects/public.js";
import type { AgentRun } from "../agent-runs/application/AgentRun.js";
import type { Logger } from "../../shared/application/Logger.js";

/** Owns project-scoped thread access and durable run transcripts. */
export class ChatThreads {
  readonly name = "chat-threads";
  private readonly pending = new Set<Promise<void>>();
  private readonly saves = new Map<string, Promise<void>>();
  private readonly codingEvidence = new CodingRunEvidence();
  constructor(
    private readonly db: PrismaClient,
    private readonly projects: ProjectService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async list(context: RequestContext, projectId: string) {
    await this.projects.find(context, projectId);
    return this.db.chatThread.findMany({
      where: { actorId: context.actor.id, projectId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  }

  async create(context: RequestContext, projectId: string) {
    await this.projects.find(context, projectId);
    return this.db.chatThread.create({
      data: { actorId: context.actor.id, projectId, title: "New chat" },
    });
  }

  async get(context: RequestContext, projectId: string, id: string) {
    const thread = await this.db.chatThread.findFirst({
      where: { id, projectId, actorId: context.actor.id },
      include: { turns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!thread) throw new NotFoundError("Chat thread not found.");
    return thread;
  }

  /** Reads only completed coding evidence from a turn owned by this actor and project. */
  async codingResult(context: RequestContext, projectId: string, runId: string) {
    await this.saves.get(runId);
    const turn = await this.db.chatTurn.findFirst({
      where: { id: runId, thread: { actorId: context.actor.id, projectId } },
      select: { events: true },
    });
    if (!turn) throw new NotFoundError("Chat run not found.");
    return this.codingEvidence.read(turn.events);
  }

  async delete(context: RequestContext, projectId: string, id?: string) {
    await this.projects.find(context, projectId);
    const result = await this.db.chatThread.deleteMany({
      where: { actorId: context.actor.id, projectId, ...(id ? { id } : {}) },
    });
    if (id && !result.count) throw new NotFoundError("Chat thread not found.");
  }

  async record(
    context: RequestContext,
    projectId: string,
    threadId: string,
    run: AgentRun,
    request: StartAgentRunRequest,
    onCodingCompleted?: () => Promise<void>,
  ) {
    const thread = await this.get(context, projectId, threadId);
    await this.db.$transaction([
      this.db.chatTurn.create({
        data: {
          id: run.id,
          threadId,
          agentName: run.agentName,
          message: request.message,
          files: [...request.files],
          debug: run.debug,
          events: [],
        },
      }),
      this.db.chatThread.update({
        where: { id: threadId },
        data: {
          title: thread.turns.length ? thread.title : request.message.slice(0, 200),
          updatedAt: new Date(),
        },
      }),
    ]);
    const events: AgentRunEventDto[] = [];
    let queue = Promise.resolve();
    run.subscribe(-1, {
      event: ({ event }) => {
        events.push(event);
        const snapshot = JSON.parse(JSON.stringify(events)) as Prisma.InputJsonValue;
        queue = queue
          .then(async () => {
            await this.db.chatTurn.updateMany({
              where: { id: run.id, threadId },
              data: { events: snapshot },
            });
          })
          .catch((error: unknown) => {
            this.logger.error({ err: error, runId: run.id }, "Failed to save chat run events.");
          });
        this.saves.set(run.id, queue);
        const pending = queue;
        this.pending.add(pending);
        void pending.then(() => {
          this.pending.delete(pending);
          if (this.saves.get(run.id) === pending) this.saves.delete(run.id);
        });
        if (event.type === "status" && event.status === "completed" && onCodingCompleted) {
          const preparation = queue
            .then(async () => {
              try {
                this.codingEvidence.read(events);
              } catch (error) {
                if (error instanceof ConflictError) return;
                throw error;
              }
              await onCodingCompleted();
            })
            .catch((error: unknown) => {
              this.logger.error(
                { err: error, runId: run.id },
                "Failed to prepare coding proposal; it can be retried from chat.",
              );
            });
          this.pending.add(preparation);
          void preparation.then(() => this.pending.delete(preparation));
        }
      },
      end: () => undefined,
    });
  }
}
