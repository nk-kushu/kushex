import type { AgentRunDto } from "@kushex/contracts";
import type { AppStore } from "../../app/store";
import type { StoreOptions } from "../../app/storeOptions";
import { breakpointsSynchronized, isFinished, runStarted, type Breakpoints } from "./runsSlice";

type Message =
  | { type: "join" }
  | { type: "breakpoints"; value: Breakpoints }
  | { type: "debug-run"; run: AgentRunDto };

/** Shares debugger preferences and session identity; each tab streams run events itself. */
export class RunTabSync {
  private channel: BroadcastChannel | null = null;
  private unsubscribe: (() => void) | null = null;
  private receiving = false;
  private previous: ReturnType<AppStore["getState"]>["runs"];

  constructor(
    private readonly store: AppStore,
    private readonly options: StoreOptions,
  ) {
    this.previous = store.getState().runs;
  }

  connect(): () => void {
    if (typeof BroadcastChannel === "undefined") return () => {};
    try {
      this.channel = new BroadcastChannel(
        `kushex:${this.options.apiBaseUrl ?? "/api"}:${this.options.instanceId ?? "default"}:debug`,
      );
    } catch {
      return () => {};
    }
    this.channel.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
    this.unsubscribe = this.store.subscribe(() => this.publishChanges());
    // An editor opened after Debug starts must discover the already-running session.
    this.channel.postMessage({ type: "join" } satisfies Message);
    return () => {
      this.unsubscribe?.();
      this.channel?.close();
      this.channel = null;
    };
  }

  private publishChanges(): void {
    const current = this.store.getState().runs;
    const previous = this.previous;
    this.previous = current;
    if (this.receiving) return;
    if (current.breakpoints !== previous.breakpoints)
      this.channel?.postMessage({
        type: "breakpoints",
        value: current.breakpoints,
      } satisfies Message);
    if (current.debugRunId !== previous.debugRunId) this.publishRun();
  }

  private publishRun(): void {
    const state = this.store.getState().runs;
    const run = state.debugRunId ? state.runs[state.debugRunId] : undefined;
    if (!run || isFinished(run.status)) return;
    this.channel?.postMessage({
      type: "debug-run",
      run: {
        id: run.id,
        projectId: run.projectId,
        agentName: run.agentName,
        debug: true,
        status: run.status,
        startedAt: run.startedAt,
      },
    } satisfies Message);
  }

  private receive(message: Message): void {
    if (!message || typeof message !== "object") return;
    this.receiving = true;
    try {
      if (message.type === "join") this.publishRun();
      else if (message.type === "breakpoints")
        this.store.dispatch(breakpointsSynchronized(message.value));
      else if (
        message.type === "debug-run" &&
        message.run.debug &&
        !isFinished(message.run.status) &&
        !this.store.getState().runs.runs[message.run.id]
      )
        this.store.dispatch(runStarted(message.run));
    } finally {
      this.receiving = false;
    }
  }
}
