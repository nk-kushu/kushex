import type { AgentRunDebugEventsDto, RecordedDebugEventDto } from "@kushex/contracts";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { Logger } from "../../../shared/application/Logger.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { AgentRun } from "./AgentRun.js";
import type { DebugEventLog, DebugStreamRef } from "./DebugEventLog.js";
import type { DebugStreamRepository } from "./DebugStreamRepository.js";

type Limits = Readonly<{
  /** Events stored per run; later ones are dropped, so a chatty agent cannot fill the disk. */
  maxEventsPerRun: number;
  /** Events read per stream in one request. */
  pageSize: number;
}>;

type Recording = { queue: Promise<void>; count: number; dropped: number; claimed: Set<string> };

/**
 * Stores the kushibot debug events that chat runs report, through kushibot's own PostgreSQL
 * store, and reads them back per run. Each run's events are stored one at a time in the
 * order the agent sent them; a failure drops that event, not the run.
 */
export class AgentRunDebugEvents {
  private readonly limits: Limits;
  private readonly recordings = new Map<string, Recording>();

  constructor(
    private readonly log: DebugEventLog,
    private readonly streams: DebugStreamRepository,
    private readonly logger: Logger,
    limits: Partial<Limits> = {},
  ) {
    this.limits = { maxEventsPerRun: 20_000, pageSize: 500, ...limits };
  }

  record(run: AgentRun, event: unknown): void {
    if (!this.log.enabled) return;
    let recording = this.recordings.get(run.id);
    if (!recording) {
      const created: Recording = {
        queue: Promise.resolve(),
        count: 0,
        dropped: 0,
        claimed: new Set(),
      };
      this.recordings.set(run.id, created);
      // Forget the run's counters once it ends and its last events are stored.
      run.subscribe(Number.MAX_SAFE_INTEGER, {
        event: () => undefined,
        end: () =>
          void created.queue.then(() => {
            if (this.recordings.get(run.id) === created) this.recordings.delete(run.id);
          }),
      });
      recording = created;
    }
    const current = recording;
    if (current.count >= this.limits.maxEventsPerRun) {
      if (current.dropped++ === 0)
        this.logger.warn(
          { runId: run.id },
          "The run reported too many debug events; dropping the rest.",
        );
      return;
    }
    current.count++;
    current.queue = current.queue
      .then(() => this.store(run, current, event))
      .catch((error: unknown) => {
        this.logger.warn({ err: error, runId: run.id }, "Could not store a debug event.");
      });
  }

  /** Resolves once every event reported so far for the run is stored (or dropped). */
  async settled(runId: string): Promise<void> {
    await this.recordings.get(runId)?.queue;
  }

  async read(
    context: RequestContext,
    runId: string,
    live: AgentRun | null,
    cursor: string | undefined,
  ): Promise<AgentRunDebugEventsDto> {
    const stored = await this.streams.forRun(runId);
    const owner = live?.actorId ?? stored.run?.actorId;
    if (owner !== context.actor.id) throw new NotFoundError("Agent run not found.");
    const run = live
      ? { ...live.dto, status: live.status }
      : {
          id: stored.run!.id,
          projectId: stored.run!.projectId,
          agentName: stored.run!.agentName,
          status: null,
          startedAt: stored.run!.startedAt.toISOString(),
        };
    const positions = decodeCursor(cursor);
    const events: RecordedDebugEventDto[] = [];
    let more = false;
    if (this.log.enabled)
      for (const stream of stored.streams) {
        const key = streamKey(stream);
        const page = await this.log.read(stream, positions[key] ?? 0, this.limits.pageSize);
        events.push(...page.items);
        if (page.items.length) positions[key] = page.items.at(-1)!.sequence;
        more ||= page.nextSequence !== null;
      }
    events.sort(
      (a, b) =>
        a.event.occurredAtEpochMs - b.event.occurredAtEpochMs ||
        a.recordedAtEpochMs - b.recordedAtEpochMs ||
        a.sequence - b.sequence,
    );
    return { run, recording: this.log.enabled, events, cursor: encodeCursor(positions), more };
  }

  private async store(run: AgentRun, recording: Recording, raw: unknown): Promise<void> {
    const event = await this.log.validate(raw);
    const stream = this.log.streamOf(event);
    const key = streamKey(stream);
    if (!recording.claimed.has(key)) {
      if (!(await this.streams.claim(run, stream)))
        throw new Error(`Debug stream ${stream.streamId} belongs to another run.`);
      recording.claimed.add(key);
    }
    await this.log.append(event);
  }
}

function streamKey(stream: DebugStreamRef): string {
  return JSON.stringify([stream.scope.scopeId, stream.scope.projectId, stream.streamId]);
}

/** The cursor maps each stream to the last sequence the client has, as base64url JSON. */
function encodeCursor(positions: Record<string, number>): string {
  return Buffer.from(JSON.stringify(positions)).toString("base64url");
}

function decodeCursor(cursor: string | undefined): Record<string, number> {
  if (!cursor) return {};
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] >= 0,
      ),
    );
  } catch {
    return {};
  }
}
