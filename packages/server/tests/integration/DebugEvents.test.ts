import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DebugEventDto } from "@kushex/contracts";
import { PostgresSqlDatabase } from "../../src/infrastructure/database/PostgresSqlDatabase.js";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { AgentRun } from "../../src/modules/agent-runs/application/AgentRun.js";
import {
  AgentRunDebugEvents,
  KushibotDebugEventLog,
  PrismaDebugStreamRepository,
} from "../../src/modules/agent-runs/public.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

const kushibotDirectory =
  process.env["KUSHEX_TEST_KUSHIBOT_DIR"] ??
  path.resolve(import.meta.dirname, "../../../../../kushibot");
const owner = { requestId: "test", actor: { id: "local-operator" } };
const logger = pino({ level: "silent" });

function debugEvent(id: string, type: string, at: number, payload: object): DebugEventDto {
  return {
    schemaVersion: 1,
    eventId: id,
    channel: "diagnostic",
    type,
    level: "debug",
    occurredAtEpochMs: at,
    producerId: "kushex-agent-runner",
    scope: { scopeId: "kb-scope", projectId: "coding" },
    identity: { operationId: "op-1", runId: "kb-run-1" },
    trace: { traceId: "trace-1", spanId: `span-${id}`, parentSpanId: null, causationEventId: null },
    payload,
  } as DebugEventDto;
}

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
let kushibotDatabase: PostgresSqlDatabase;
beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const migration of [
    "20261023000000_projects_and_workspaces",
    "20261028151503_agent_run_debug_streams",
  ])
    await migrator.add(
      migration,
      await readFile(
        new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
  await migrator.deploy(temporary.url);
  database = new PrismaDatabase(
    { url: temporary.url, maxConnections: 4, connectionTimeoutMs: 1000 },
    logger,
  );
  await database.start();
  kushibotDatabase = new PostgresSqlDatabase({
    url: temporary.url,
    schema: "kushibot",
    maxConnections: 4,
    connectionTimeoutMs: 1000,
  });
});
afterEach(async () => {
  await kushibotDatabase?.stop();
  await database?.stop();
  await temporary?.drop();
  await migrator?.remove();
});

describe.skipIf(!existsSync(path.join(kushibotDirectory, "dist/index.js")))(
  "debug events in PostgreSQL",
  () => {
    it("stores events through kushibot's SqlDebugEventStore and reads them per run", async () => {
      const debugEvents = new AgentRunDebugEvents(
        new KushibotDebugEventLog(kushibotDirectory, kushibotDatabase),
        new PrismaDebugStreamRepository(database.client),
        logger,
      );
      const run = new AgentRun("local-operator", crypto.randomUUID(), "coding", false);
      debugEvents.record(
        run,
        debugEvent("e1", "operation.started", 10, { operation: "model.call" }),
      );
      debugEvents.record(
        run,
        debugEvent("e2", "operation.completed", 20, { operation: "model.call", durationMs: 12.5 }),
      );
      // Rejected by kushibot's contract (unknown payload field): dropped, not stored.
      debugEvents.record(run, debugEvent("e3", "progress.reported", 30, { secret: "x" }));
      await debugEvents.settled(run.id);

      const page = await debugEvents.read(owner, run.id, null, undefined);
      expect(page.run).toMatchObject({ id: run.id, agentName: "coding", status: null });
      expect(page.events.map((item) => [item.streamId, item.sequence, item.event.eventId])).toEqual(
        [
          ["run:kb-run-1", 1, "e1"],
          ["run:kb-run-1", 2, "e2"],
        ],
      );
      expect(page.events[1]!.event.payload).toEqual({ operation: "model.call", durationMs: 12.5 });
      const after = await debugEvents.read(owner, run.id, null, page.cursor);
      expect(after.events).toEqual([]);

      // The tables are kushibot's, in their own schema; Kushex only maps streams to runs.
      const tables = await kushibotDatabase.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kushibot' ORDER BY 1",
        [],
      );
      expect(tables.rows.map((row) => row["table_name"])).toEqual([
        "kushibot_debug_events",
        "kushibot_debug_streams",
      ]);

      // Another run cannot write into this run's stream.
      const other = new AgentRun("local-operator", run.projectId, "coding", false);
      debugEvents.record(other, debugEvent("e4", "progress.reported", 40, { operation: "x" }));
      await debugEvents.settled(other.id);
      expect((await debugEvents.read(owner, run.id, null, page.cursor)).events).toEqual([]);
    });
  },
);
