import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";

/** A stored kushibot debug event of run `r1`; later sequences occur 10 ms apart. */
export function recorded(
  sequence: number,
  type: string,
  level: DebugEventDto["level"],
  payload: DebugEventDto["payload"],
): RecordedDebugEventDto {
  return {
    streamId: "run:r1",
    sequence,
    recordedAtEpochMs: 1_000 + sequence,
    event: {
      schemaVersion: 1,
      eventId: `e${sequence}`,
      channel: "diagnostic",
      type,
      level,
      occurredAtEpochMs: 1_000 + sequence * 10,
      producerId: "test",
      scope: { scopeId: "s", projectId: "p" },
      identity: { operationId: "o", runId: "r1" },
      trace: {
        traceId: "t",
        spanId: `span${sequence}`,
        parentSpanId: "root",
        causationEventId: null,
      },
      payload,
    },
  };
}
