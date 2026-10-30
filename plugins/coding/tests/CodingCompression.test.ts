import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AgentRuntimeFactory,
  type ArtifactRef,
  type ArtifactWriteRequest,
  type IAgentToolCall,
  type IArtifactWriter,
  type IExecutionContext,
  type ModelRequest,
  type TaskInput,
} from "kushibot";
import { JsonValueContract, TaskInputContract } from "kushibot";
import { createCodingAgent } from "../src/composition/createCodingAgent";
import { CompressingCodingSessions } from "../src/context/CompressingCodingSessions";
import { SessionContextLedger } from "../src/context/SessionContextLedger";
import { createCodingCompression } from "../src/context/createCodingCompression";
import { ScriptedGateway, profile } from "./fixtures/ScriptedGateway";

class RecordingArtifactWriter implements IArtifactWriter {
  readonly writes = new Map<string, { reference: ArtifactRef; request: ArtifactWriteRequest }>();
  async write(request: ArtifactWriteRequest): Promise<ArtifactRef> {
    const prior = this.writes.get(request.idempotencyKey);
    if (prior) return prior.reference;
    const reference: ArtifactRef = {
      artifactId: `stored-${this.writes.size + 1}`,
      digest: createHash("sha256").update(request.data).digest("hex"),
      byteLength: request.data.byteLength,
      mediaType: request.mediaType,
      schemaId: request.schemaId,
      schemaVersion: request.schemaVersion,
    };
    this.writes.set(request.idempotencyKey, { reference, request });
    return reference;
  }
}

const scope = { scopeId: "scope", projectId: "coding", workspaceId: "workspace" };
const context = (operationId: string): IExecutionContext => ({
  identity: { operationId },
  scope,
  signal: new AbortController().signal,
  deadlineEpochMs: null,
  reporter: { async progress() {} },
});

/** A long, repetitive tool result: the case this compression exists for. */
const POLL = JSON.stringify({
  toolId: "cli",
  value: {
    command: "npm test",
    status: "queued",
    detail: "The regression run for the login callback has not started; worker unavailable.",
  },
});

test("custom seams compress repeated observations and install a new snapshot", async () => {
  const ledger = new SessionContextLedger("session-1", scope);
  const artifacts = new RecordingArtifactWriter();
  const { compression, installer } = createCodingCompression(
    ledger,
    artifacts,
    { nowEpochMs: () => 1_000 },
    { event: () => null, operation: async (_name, work) => work() },
    // keepRecent 0 so the test controls the window directly.
    { keepRecent: 0, minimumByteSaving: 256 },
  );

  ledger.setRequired([
    {
      id: "task",
      kind: "source",
      revisionRef: "task:v1",
      sourceRef: "session:session-1/task",
      text: JSON.stringify({ goal: "Review the login callback." }),
      priority: 100,
    },
  ]);
  for (let index = 1; index <= 6; index += 1)
    ledger.appendObservation(`result:${index}`, `session:session-1/result/${index}`, POLL, 40);

  const input = {
    snapshotRef: ledger.snapshotRef,
    scope,
    instructions: { revision: "coding:v1", text: "Edit only permitted files." },
    guidance: [],
    requiredRules: [],
    assignment: {
      goal: "Review the login callback.",
      acceptanceCriteria: ["Preserve password login."],
      unresolved: [],
      pendingOperationRefs: [],
    },
    requiredFragments: ledger.requiredFragments,
    optionalFragments: ledger.optionalFragments,
  };

  const outcome = await compression.compress(input, context("op:compress-1"));
  assert.equal(outcome.status, "prepared", JSON.stringify(outcome));
  if (outcome.status !== "prepared") return;

  // Six identical observations became one point citing all six.
  assert.equal(outcome.summary.points.length, 1);
  assert.equal(outcome.summary.sources.length, 6);
  // Both measures must drop, or the service would have returned NO_MEASURED_SAVING.
  assert.ok(outcome.measurement.afterMessageBytes < outcome.measurement.beforeMessageBytes);
  assert.ok(
    outcome.measurement.afterInputTokenUpperBound < outcome.measurement.beforeInputTokenUpperBound,
  );
  assert.equal(artifacts.writes.size, 1);

  // Installation is a separate step and must mint a new snapshot reference.
  const before = ledger.snapshotRef;
  const installed = await installer.install(outcome, context("op:compress-1"));
  ledger.adopt(installed.snapshotRef);
  assert.notEqual(ledger.snapshotRef, before);
  assert.equal(ledger.optionalFragments.length, 1);
  assert.equal(ledger.optionalFragments[0]?.kind, "summary");

  // The saved record keeps every original id, so provenance survives the grouping.
  const saved = JSON.parse(
    new TextDecoder().decode([...artifacts.writes.values()][0]!.request.data),
  );
  assert.deepEqual(
    saved.sources.map((source: { id: string }) => source.id),
    ["result:1", "result:2", "result:3", "result:4", "result:5", "result:6"],
  );

  // A second pass must not summarize the summary.
  const again = await compression.compress(
    { ...input, snapshotRef: ledger.snapshotRef, optionalFragments: ledger.optionalFragments },
    context("op:compress-2"),
  );
  assert.equal(again.status, "unchanged");
  assert.equal(artifacts.writes.size, 1);
});

test("acceptance rejects a window too small to pay for its own bookkeeping", async () => {
  const ledger = new SessionContextLedger("session-2", scope);
  const artifacts = new RecordingArtifactWriter();
  const { compression } = createCodingCompression(
    ledger,
    artifacts,
    { nowEpochMs: () => 1_000 },
    { event: () => null, operation: async (_name, work) => work() },
    { keepRecent: 0, minimumByteSaving: 256 },
  );
  ledger.setRequired([]);
  // Two short duplicates: collapsing them would make the request bigger.
  for (const index of [1, 2])
    ledger.appendObservation(`result:${index}`, `session:session-2/result/${index}`, "queued", 40);

  const outcome = await compression.compress(
    {
      snapshotRef: ledger.snapshotRef,
      scope,
      instructions: { revision: "coding:v1", text: "Edit only permitted files." },
      guidance: [],
      requiredRules: [],
      assignment: {
        goal: "Review the login callback.",
        acceptanceCriteria: [],
        unresolved: [],
        pendingOperationRefs: [],
      },
      requiredFragments: [],
      optionalFragments: ledger.optionalFragments,
    },
    context("op:compress-3"),
  );

  assert.equal(outcome.status, "unchanged");
  if (outcome.status === "unchanged") assert.equal(outcome.code, "SUMMARY_NOT_ACCEPTED");
  // Rejected at acceptance, so no artifact was written at all.
  assert.equal(artifacts.writes.size, 0);
});

test("a stale snapshot reference is refused by the provenance verifier", async () => {
  const ledger = new SessionContextLedger("session-3", scope);
  const { compression } = createCodingCompression(
    ledger,
    new RecordingArtifactWriter(),
    { nowEpochMs: () => 1_000 },
    { event: () => null, operation: async (_name, work) => work() },
    { keepRecent: 0 },
  );
  ledger.setRequired([]);
  for (const index of [1, 2])
    ledger.appendObservation(`result:${index}`, `session:session-3/result/${index}`, POLL, 40);
  const optionalFragments = ledger.optionalFragments;
  const stale = ledger.snapshotRef;

  // Something else happened after this view was captured.
  ledger.appendObservation("result:3", "session:session-3/result/3", POLL, 40);

  const outcome = await compression.compress(
    {
      snapshotRef: stale,
      scope,
      instructions: { revision: "coding:v1", text: "Edit only permitted files." },
      guidance: [],
      requiredRules: [],
      assignment: {
        goal: "Review the login callback.",
        acceptanceCriteria: [],
        unresolved: [],
        pendingOperationRefs: [],
      },
      requiredFragments: [],
      optionalFragments,
    },
    context("op:compress-4"),
  );

  assert.equal(outcome.status, "unchanged");
  if (outcome.status === "unchanged") assert.equal(outcome.code, "SOURCE_SNAPSHOT_UNVERIFIED");
});

test("a compressing session sends the composed shape and compresses as it runs", async () => {
  const artifacts = new RecordingArtifactWriter();
  // The model polls the same command repeatedly, then finishes.
  const actions = [
    ...Array.from({ length: 7 }, () => ({
      kind: "tool",
      toolId: "cli",
      arguments: { command: "npm test" },
    })),
    {
      kind: "final",
      value: { goal: "Done", acceptanceCriteria: ["ok"], filePaths: [], sourceRefs: [] },
    },
  ];
  const gateway = new ScriptedGateway(actions);
  const runtime = await new AgentRuntimeFactory({ gateway, profile, scope }).create("coding");

  // A tool that always returns the same long result: the duplicate case.
  const tools: IAgentToolCall = {
    async dispatch(request) {
      return {
        status: "completed" as const,
        observation: {
          operationId: request.operationId,
          toolId: "cli",
          toolVersion: "1",
          value: JSON.parse(POLL).value,
        },
        replayed: false,
      };
    },
  };

  const sessions = new CompressingCodingSessions<TaskInput>(
    runtime,
    {
      async apply(request) {
        return {
          instructions: request.assignment.instructions,
          input: { task: request.input, acceptedPlan: null },
          tools,
          acceptance: { apply: async () => ({ accepted: true, feedback: "" }) },
        };
      },
    },
    gateway,
    profile,
    artifacts,
    60_000,
    { keepRecent: 2, minimumByteSaving: 256 },
  );

  const task: TaskInput = {
    goal: "Review the login callback",
    acceptanceCriteria: ["Preserve password login"],
    filePaths: [],
    sourceRefs: [],
  };
  const sessionContext: IExecutionContext = {
    ...runtime.context,
    identity: { ...runtime.context.identity, sessionId: "session-run-1" },
  };
  const factory = await sessions.create(
    { input: task, assignment: { instructions: "Plan the work." }, mode: "structured" },
    new TaskInputContract(new JsonValueContract()),
    sessionContext,
  );
  const session = await factory.create();
  const outcome = await session.execute(sessionContext);

  assert.equal(outcome.status, "completed", JSON.stringify(outcome));

  // The composed shape: two user messages (assignment, then required/optional context),
  // not a growing transcript. This is what proves the custom turn was used.
  const first: ModelRequest = gateway.requests[0]!;
  assert.equal(first.messages.length, 2);
  assert.ok(JSON.parse(first.messages[0]!.text).assignment);
  assert.ok(JSON.parse(first.messages[1]!.text).optionalContext);

  // Compression ran during the session and installed at least one summary.
  assert.ok(artifacts.writes.size >= 1, "expected at least one summary artifact");
  const last = JSON.parse(gateway.requests.at(-1)!.messages[1]!.text);
  assert.ok(
    last.optionalContext.some((fragment: { kind: string }) => fragment.kind === "summary"),
    "expected a summary fragment in the final request",
  );
});

test("the agent composes with compression off and on", async () => {
  const artifacts = new RecordingArtifactWriter();
  const base = {
    workspace: process.cwd(),
    artifacts,
    profile,
    gateway: new ScriptedGateway([]),
    scope,
  } as const;

  // Off by default: sessions keep kushibot's AgentModelTurn and one growing conversation.
  assert.ok(createCodingAgent({ ...base }));
  // Enabled: sessions are built by CompressingCodingSessions instead.
  assert.ok(createCodingAgent({ ...base, compression: { enabled: true, keepRecent: 4 } }));
});
