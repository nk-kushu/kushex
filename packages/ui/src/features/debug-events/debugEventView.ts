import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";

export type DebugLevel = DebugEventDto["level"];
export const LEVELS: readonly DebugLevel[] = ["trace", "debug", "info", "warn", "error"];

export type DebugEventFilter = Readonly<{ minLevel: DebugLevel; query: string; spans: boolean }>;

/** Events at or above the level whose type, operation, summary, refs or ids contain the query. */
export function filterEvents(
  events: readonly RecordedDebugEventDto[],
  { minLevel, query, spans }: DebugEventFilter,
): RecordedDebugEventDto[] {
  const min = LEVELS.indexOf(minLevel);
  const needle = query.trim().toLowerCase();
  return events.filter(({ event }) => {
    if (LEVELS.indexOf(event.level) < min) return false;
    // Without spans, an operation shows once: its completed or failed event carries the duration.
    if (!spans && event.type === "operation.started") return false;
    if (!needle) return true;
    const { payload } = event;
    return [
      event.type,
      payload.operation,
      payload.summary,
      payload.code,
      payload.nextState,
      ...(payload.relatedRefs ?? []),
      event.trace.spanId,
      event.identity.stepRunId,
      event.identity.sessionId,
    ].some((text) => text?.toLowerCase().includes(needle));
  });
}

/** "+0.000s", "+12.345s", "+2m 03.5s": time since the run's first event. */
export function formatOffset(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `+${seconds.toFixed(3)}s`;
  const minutes = Math.floor(seconds / 60);
  return `+${minutes}m ${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}s`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** The headline of an event: its operation, or failing that the type's last part. */
export function eventTitle(event: DebugEventDto): string {
  return event.payload.operation ?? event.type;
}

/** Started → completed/failed: how far into an operation span the event is. */
export function spanPhase(event: DebugEventDto): "start" | "end" | null {
  if (event.type === "operation.started") return "start";
  if (event.type === "operation.completed" || event.type === "operation.failed") return "end";
  return null;
}

/** Event counts by level, for the header. */
export function countByLevel(events: readonly RecordedDebugEventDto[]): Record<DebugLevel, number> {
  const counts = { trace: 0, debug: 0, info: 0, warn: 0, error: 0 };
  for (const { event } of events) counts[event.level]++;
  return counts;
}
