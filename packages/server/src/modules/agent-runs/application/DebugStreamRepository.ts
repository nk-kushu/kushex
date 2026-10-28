import type { AgentRun } from "./AgentRun.js";
import type { DebugStreamRef } from "./DebugEventLog.js";

/** What the page shows of a run once the server no longer holds it. */
export type RecordedRunDto = Readonly<{
  id: string;
  actorId: string;
  projectId: string;
  agentName: string;
  startedAt: Date;
}>;

/** Which chat run each debug-event stream belongs to. */
export interface DebugStreamRepository {
  /** Assigns the stream to the run; false when another run already owns it. */
  claim(run: AgentRun, stream: DebugStreamRef): Promise<boolean>;
  /** The run's streams, oldest first, with the run they belong to. */
  forRun(
    runId: string,
  ): Promise<Readonly<{ run: RecordedRunDto | null; streams: readonly DebugStreamRef[] }>>;
}
