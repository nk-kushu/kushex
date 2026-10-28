import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRunDebugEventsDto,
  DebugEventDto,
  RecordedDebugEventDto,
} from "@kushex/contracts";
import { InMemoryProjectRepository } from "../../../tests/support/InMemoryProjectRepository.js";
import { WorkspaceFixture } from "../../../tests/support/WorkspaceFixture.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { LocalOperatorActorResolver } from "../../transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import {
  AgentService,
  AgentTemplate,
  KushibotTypesReader,
  LocalAgentStore,
} from "../agents/public.js";
import { ProjectService } from "../projects/public.js";
import {
  LocalWorkspaceFileSystem,
  WorkspacePathResolver,
  WorkspaceService,
} from "../workspaces/public.js";
import { AgentRun } from "./application/AgentRun.js";
import type { DebugEventLog, DebugStreamRef } from "./application/DebugEventLog.js";
import type { DebugStreamRepository, RecordedRunDto } from "./application/DebugStreamRepository.js";
import {
  AgentRunDebugEvents,
  AgentRunService,
  AgentRunsController,
  ChildProcessAgentLauncher,
} from "./public.js";

const owner = { requestId: "test", actor: { id: "local-operator" } };
const logger = pino({ level: "silent" });

function debugEvent(id: string, runId: string, at: number, scopeId = "scope"): DebugEventDto {
  return {
    schemaVersion: 1,
    eventId: id,
    channel: "diagnostic",
    type: "progress.reported",
    level: "info",
    occurredAtEpochMs: at,
    producerId: "test",
    scope: { scopeId, projectId: "agent" },
    identity: { operationId: "op", runId },
    trace: { traceId: "trace", spanId: `span-${id}`, parentSpanId: null, causationEventId: null },
    payload: { summary: id },
  };
}

/** Stores events per stream in memory; rejects anything without an `eventId`. */
class MemoryDebugEventLog implements DebugEventLog {
  readonly enabled = true;
  readonly streams = new Map<string, RecordedDebugEventDto[]>();
  readonly received: unknown[] = [];

  async validate(event: unknown): Promise<DebugEventDto> {
    this.received.push(event);
    if (typeof event !== "object" || event === null || !("eventId" in event))
      throw new Error("Not a debug event.");
    return event as DebugEventDto;
  }

  streamOf(event: DebugEventDto): DebugStreamRef {
    return { scope: event.scope, streamId: `run:${event.identity.runId}` };
  }

  async append(event: DebugEventDto): Promise<void> {
    const { streamId } = this.streamOf(event);
    const key = `${event.scope.scopeId}|${streamId}`;
    const stream = this.streams.get(key) ?? [];
    stream.push({ streamId, sequence: stream.length + 1, recordedAtEpochMs: Date.now(), event });
    this.streams.set(key, stream);
  }

  async read(stream: DebugStreamRef, afterSequence: number, limit: number) {
    const all = this.streams.get(`${stream.scope.scopeId}|${stream.streamId}`) ?? [];
    const items = all.filter((item) => item.sequence > afterSequence).slice(0, limit);
    const last = items.at(-1)?.sequence ?? afterSequence;
    return { items, nextSequence: all.some((item) => item.sequence > last) ? last : null };
  }
}

class MemoryDebugStreams implements DebugStreamRepository {
  readonly owners = new Map<string, { run: RecordedRunDto; stream: DebugStreamRef }>();

  async claim(run: AgentRun, stream: DebugStreamRef): Promise<boolean> {
    const key = `${stream.scope.scopeId}|${stream.streamId}`;
    const existing = this.owners.get(key);
    if (existing) return existing.run.id === run.id;
    this.owners.set(key, { run: { ...run, id: run.id }, stream });
    return true;
  }

  async forRun(runId: string) {
    const owned = [...this.owners.values()].filter((entry) => entry.run.id === runId);
    return { run: owned[0]?.run ?? null, streams: owned.map((entry) => entry.stream) };
  }
}

describe("agent run debug events", () => {
  it("stores a run's events in order and reads them back page by page", async () => {
    const log = new MemoryDebugEventLog();
    const debugEvents = new AgentRunDebugEvents(log, new MemoryDebugStreams(), logger, {
      pageSize: 2,
    });
    const run = new AgentRun("local-operator", "project", "coding", false);
    for (const [index, id] of ["a", "b", "c"].entries())
      debugEvents.record(run, debugEvent(id, "kb-1", 100 + index));
    debugEvents.record(run, debugEvent("d", "kb-2", 50));
    debugEvents.record(run, { not: "an event" });
    await debugEvents.settled(run.id);

    const first = await debugEvents.read(owner, run.id, run, undefined);
    expect(first.run).toMatchObject({ id: run.id, agentName: "coding", status: "starting" });
    // Two streams, two events each per page; merged by time.
    expect(first.events.map((item) => item.event.eventId)).toEqual(["d", "a", "b"]);
    expect(first.more).toBe(true);
    const second = await debugEvents.read(owner, run.id, run, first.cursor);
    expect(second.events.map((item) => item.event.eventId)).toEqual(["c"]);
    expect(second.more).toBe(false);
    const caughtUp = await debugEvents.read(owner, run.id, run, second.cursor);
    expect(caughtUp.events).toEqual([]);
  });

  it("keeps stored events readable after the server forgets the run", async () => {
    const debugEvents = new AgentRunDebugEvents(
      new MemoryDebugEventLog(),
      new MemoryDebugStreams(),
      logger,
    );
    const run = new AgentRun("local-operator", "project", "coding", false);
    debugEvents.record(run, debugEvent("a", "kb-1", 1));
    await debugEvents.settled(run.id);
    const page = await debugEvents.read(owner, run.id, null, undefined);
    expect(page.run).toMatchObject({ id: run.id, agentName: "coding", status: null });
    expect(page.events).toHaveLength(1);
    await expect(
      debugEvents.read({ requestId: "t", actor: { id: "someone-else" } }, run.id, null, undefined),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not let a run write into another run's stream, and caps events per run", async () => {
    const log = new MemoryDebugEventLog();
    const debugEvents = new AgentRunDebugEvents(log, new MemoryDebugStreams(), logger, {
      maxEventsPerRun: 2,
    });
    const first = new AgentRun("local-operator", "project", "coding", false);
    const second = new AgentRun("local-operator", "project", "coding", false);
    debugEvents.record(first, debugEvent("a", "kb-1", 1));
    await debugEvents.settled(first.id);
    debugEvents.record(second, debugEvent("b", "kb-1", 2));
    for (const id of ["c", "d", "e"]) debugEvents.record(second, debugEvent(id, "kb-2", 3));
    await debugEvents.settled(second.id);
    const firstPage = await debugEvents.read(owner, first.id, first, undefined);
    expect(firstPage.events.map((item) => item.event.eventId)).toEqual(["a"]);
    const secondPage = await debugEvents.read(owner, second.id, second, undefined);
    expect(secondPage.events.map((item) => item.event.eventId)).toEqual(["c"]);
    // "d" and "e" were over the cap, so they never reached validation.
    expect(log.received).toHaveLength(3);
  });
});

/** The kushibot checkout next to kushex, when built; the runner loads it like the server does. */
const kushibotDirectory =
  process.env["KUSHEX_TEST_KUSHIBOT_DIR"] ??
  path.resolve(import.meta.dirname, "../../../../../../kushibot");
const hasKushibot = existsSync(path.join(kushibotDirectory, "dist/index.js"));

const TRACED_AGENT = `export async function chat(request) {
  const debug = request.debug.create({
    scope: { scopeId: "kushex-test", projectId: "traced" },
    identity: { operationId: "op-1", runId: "kb-run-1" },
  });
  await debug.operation("model.call", async () => request.progress("thinking"));
  debug.event("progress.reported", "info", { summary: "line one\\nline two" });
  return "done";
}
`;

describe.skipIf(!hasKushibot)("debug events from a running agent", () => {
  let fixture: WorkspaceFixture | undefined;
  let agentsDirectory: string | undefined;
  let service: AgentRunService | undefined;
  let server: HttpServer | undefined;
  afterEach(async () => {
    await service?.stop();
    await server?.stop(new AbortController().signal);
    await fixture?.remove();
    if (agentsDirectory) await rm(agentsDirectory, { recursive: true, force: true });
  });

  it("reaches the server over IPC with free-text summaries kept, and is served per run", async () => {
    fixture = await WorkspaceFixture.create();
    agentsDirectory = await mkdtemp(path.join(tmpdir(), "kushex-debug-agents-"));
    await writeFile(path.join(agentsDirectory, "package.json"), '{ "type": "module" }\n');
    await mkdir(path.join(agentsDirectory, "traced"));
    await writeFile(path.join(agentsDirectory, "traced/agent.ts"), TRACED_AGENT);
    const repository = new InMemoryProjectRepository();
    const paths = new WorkspacePathResolver(fixture.roots);
    const workspaces = new WorkspaceService(repository, new LocalWorkspaceFileSystem(paths));
    const log = new MemoryDebugEventLog();
    const debugEvents = new AgentRunDebugEvents(log, new MemoryDebugStreams(), logger);
    service = new AgentRunService(
      workspaces,
      paths,
      new AgentService(
        new LocalAgentStore(agentsDirectory),
        new AgentTemplate(),
        new KushibotTypesReader(null),
      ),
      new ChildProcessAgentLauncher(kushibotDirectory, logger),
      debugEvents,
    );
    const project = await new ProjectService(repository, workspaces).create(owner, {
      name: "Alpha",
      path: "root/alpha",
    });
    server = new HttpServer(
      { host: "127.0.0.1", port: 0 },
      logger,
      new ErrorResponder(logger),
      [
        new AgentRunsController(
          service,
          new RequestContextFactory(new LocalOperatorActorResolver()),
          debugEvents,
        ),
      ],
      new LocalRequestGuard([]),
    );
    await server.start();

    const run = await service.launch(owner, project.id, {
      agentName: "traced",
      message: "go",
      files: [],
      debug: false,
    });
    const live = service.find(owner, run.id);
    await new Promise<void>((resolve) =>
      live.subscribe(-1, { event: () => undefined, end: resolve }),
    );
    expect(live.status).toBe("completed");
    await debugEvents.settled(run.id);

    const response = await fetch(
      `http://127.0.0.1:${server.port}/agent-runs/${run.id}/debug-events`,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as AgentRunDebugEventsDto;
    expect(page.recording).toBe(true);
    expect(
      page.events.map(({ event }) => [
        event.type,
        event.payload.operation ?? event.payload.summary,
      ]),
    ).toEqual([
      ["operation.started", "model.call"],
      ["operation.completed", "model.call"],
      ["progress.reported", "line one line two"],
    ]);
    expect(page.events.every(({ event }) => event.identity.runId === "kb-run-1")).toBe(true);
    expect(page.events[1]!.event.payload.durationMs).toBeGreaterThanOrEqual(0);
  });
});
