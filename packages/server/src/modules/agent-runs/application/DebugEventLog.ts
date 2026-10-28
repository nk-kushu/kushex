import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";

/** A kushibot debug-event stream: `run:<kushibot run id>` (or `trace:<id>`) within a scope. */
export type DebugStreamRef = Readonly<{
  scope: DebugEventDto["scope"];
  streamId: string;
}>;

export type DebugEventPageResult = Readonly<{
  items: readonly RecordedDebugEventDto[];
  /** Null when the stream has no more events after this page. */
  nextSequence: number | null;
}>;

/** kushibot's debug-event store; events are validated against kushibot's contract. */
export interface DebugEventLog {
  /** False when there is no kushibot to store events with; reads then return nothing. */
  readonly enabled: boolean;
  /** Checks an untrusted event; throws when it is not a valid kushibot debug event. */
  validate(event: unknown): Promise<DebugEventDto>;
  streamOf(event: DebugEventDto): DebugStreamRef;
  append(event: DebugEventDto): Promise<void>;
  read(stream: DebugStreamRef, afterSequence: number, limit: number): Promise<DebugEventPageResult>;
}
