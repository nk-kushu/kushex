import { randomUUID } from "node:crypto";
import type { AgentRunDto, AgentRunEventDto, AgentRunStatus } from "@kushex/contracts";
import { ConflictError } from "../../../errors/ConflictError.js";
import type { AgentRunDebugger, AgentRunProcess } from "./AgentLauncher.js";

export type AgentRunEntry = Readonly<{ seq: number; event: AgentRunEventDto }>;
type Subscriber = Readonly<{ event: (entry: AgentRunEntry) => void; end: () => void }>;

/** Output kept for replay; later output still streams to connected clients. */
const MAX_OUTPUT_CHARS = 1_000_000;
const TERMINAL: ReadonlySet<AgentRunStatus> = new Set(["completed", "failed", "cancelled"]);

/** One chat message run through an agent: its status and an ordered, replayable event log. */
export class AgentRun {
  readonly id = randomUUID();
  readonly startedAt = new Date();
  private currentStatus: AgentRunStatus = "starting";
  private readonly log: AgentRunEntry[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private outputChars = 0;
  private process: AgentRunProcess | null = null;
  private attached: AgentRunDebugger | null = null;

  constructor(
    readonly actorId: string,
    readonly projectId: string,
    readonly agentName: string,
    readonly debug: boolean,
  ) {
    this.log.push({ seq: 0, event: { type: "status", status: "starting" } });
  }

  get status(): AgentRunStatus {
    return this.currentStatus;
  }

  get finished(): boolean {
    return TERMINAL.has(this.currentStatus);
  }

  get dto(): AgentRunDto {
    return {
      id: this.id,
      projectId: this.projectId,
      agentName: this.agentName,
      debug: this.debug,
      status: this.currentStatus,
      startedAt: this.startedAt.toISOString(),
    };
  }

  /** The debugger of a debug run once it is attached. */
  get debugger(): AgentRunDebugger {
    if (!this.attached)
      throw new ConflictError(
        this.debug ? "The debugger is not attached." : "This run was not started in debug mode.",
      );
    return this.attached;
  }

  attach(process: AgentRunProcess): void {
    this.process = process;
  }

  attachDebugger(debug: AgentRunDebugger | null): void {
    this.attached = debug;
  }

  cancel(): void {
    if (!this.finished) this.process?.cancel();
  }

  /** Records an event; status follows pause, resume and status events. Ignored once finished. */
  emit(event: AgentRunEventDto): void {
    if (this.finished) return;
    if (event.type === "status") {
      if (event.status === this.currentStatus) return;
      this.currentStatus = event.status;
    } else if (event.type === "paused") this.emit({ type: "status", status: "paused" });
    if (event.type === "output") this.outputChars += event.text.length;
    const kept = event.type !== "output" || this.outputChars <= MAX_OUTPUT_CHARS;
    // Events past the replay limit carry no sequence number, so a reconnect skips them.
    const entry = { seq: kept ? this.log.length : -1, event };
    if (kept) this.log.push(entry);
    for (const subscriber of this.subscribers) subscriber.event(entry);
    if (event.type === "resumed") this.emit({ type: "status", status: "running" });
    if (this.finished) {
      this.attached = null;
      for (const subscriber of this.subscribers) subscriber.end();
      this.subscribers.clear();
    }
  }

  /**
   * Replays the events after `afterSeq`, then streams new ones until the run finishes.
   * Returns the unsubscribe function.
   */
  subscribe(afterSeq: number, subscriber: Subscriber): () => void {
    for (const entry of this.log.slice(Math.max(0, afterSeq + 1))) subscriber.event(entry);
    if (this.finished) {
      subscriber.end();
      return () => undefined;
    }
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}
