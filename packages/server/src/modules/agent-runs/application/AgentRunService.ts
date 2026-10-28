import type { AgentRunDto, StartAgentRunRequest } from "@kushex/contracts";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { ManagedResource } from "../../../shared/application/ManagedResource.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { AgentService } from "../../agents/public.js";
import type { WorkspacePathResolver, WorkspaceService } from "../../workspaces/public.js";
import type { AgentLauncher, AgentRunProcess } from "./AgentLauncher.js";
import { AgentRun } from "./AgentRun.js";
import type { ChatThreads } from "../../chat-threads/ChatThreads.js";

/** Receives the kushibot debug events a run's agent reports. */
export interface DebugEventRecorder {
  record(run: AgentRun, event: unknown): void;
}

type Limits = Readonly<{ maxActiveRuns: number; maxKeptRuns: number }>;

/**
 * Starts agent runs for the project chat and keeps them in memory: runs are for trying an
 * agent out, so they do not survive a server restart. One debug run at a time, because the
 * editor shows one debugger.
 */
export class AgentRunService implements ManagedResource {
  readonly name = "agent-runs";
  private readonly runs = new Map<string, AgentRun>();
  private readonly processes = new Map<string, AgentRunProcess>();
  private readonly limits: Limits;

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly paths: WorkspacePathResolver,
    private readonly agents: AgentService,
    private readonly launcher: AgentLauncher,
    private readonly debugEvents: DebugEventRecorder | null = null,
    limits: Partial<Limits> = {},
    private readonly threads: ChatThreads | null = null,
  ) {
    this.limits = { maxActiveRuns: 4, maxKeptRuns: 50, ...limits };
  }

  async launch(
    context: RequestContext,
    projectId: string,
    request: StartAgentRunRequest,
  ): Promise<AgentRunDto> {
    const { workspace } = await this.workspaces.forProject(context, projectId);
    const checkout = await this.paths.resolve(workspace.path);
    const entry = await this.agents.entry(request.agentName);
    const active = [...this.runs.values()].filter((run) => !run.finished);
    if (active.length >= this.limits.maxActiveRuns)
      throw new ConflictError("Too many agent runs are in progress; stop one first.");
    if (request.debug && active.some((run) => run.debug))
      throw new ConflictError("A debug session is already running; stop it first.");
    const run = new AgentRun(context.actor.id, projectId, request.agentName, request.debug);
    if (request.threadId) {
      if (!this.threads) throw new ConflictError("Chat thread storage is unavailable.");
      await this.threads.record(context, projectId, request.threadId, run, request);
    }
    this.keep(run);
    const process = this.launcher.launch({
      run,
      entry: entry.primaryFile,
      agentDirectory: entry.directory,
      workspace: checkout.absolute,
      message: request.message,
      files: request.files,
      breakpoints: request.breakpoints ?? {},
      recordDebugEvent: (event) => this.debugEvents?.record(run, event),
    });
    run.attach(process);
    this.processes.set(run.id, process);
    return run.dto;
  }

  find(context: RequestContext, id: string): AgentRun {
    const run = this.findLive(context, id);
    if (!run) throw new NotFoundError("Agent run not found.");
    return run;
  }

  /** The run while the server still holds it, otherwise null. */
  findLive(context: RequestContext, id: string): AgentRun | null {
    const run = this.runs.get(id);
    return run && run.actorId === context.actor.id ? run : null;
  }

  async start(): Promise<void> {}

  /** Ends every agent process; their runs are lost with the server anyway. */
  async stop(): Promise<void> {
    for (const process of this.processes.values()) process.kill();
    this.processes.clear();
  }

  /** Forgets the oldest finished runs past the limit. */
  private keep(run: AgentRun): void {
    this.runs.set(run.id, run);
    for (const [id, kept] of this.runs) {
      if (this.runs.size <= this.limits.maxKeptRuns) break;
      if (kept.finished) {
        this.runs.delete(id);
        this.processes.delete(id);
      }
    }
  }
}
