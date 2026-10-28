import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, AgentRuntimeFactory, type ArtifactRef, type ArtifactWriteRequest, type IArtifactWriter, type ModelRequest } from "kushibot";
import { LocalChatArtifacts } from "../infrastructure/LocalChatArtifacts";
import { WorkspaceEvidence } from "kushibot";
import { ReadFileTool } from "../tools/ReadFileTool";
import { WorkspaceTools } from "../WorkspaceTools";
import { ScriptedGateway, profile } from "./ScriptedGateway";
import { chat, createOpenAiCodingAgent } from "../agent";
import { createCodingAgent as createAgent } from "../factories/createCodingAgent";
import type { CodingAgentOptions } from "../CodingAgentOptions";

function createCodingAgent(options: Omit<CodingAgentOptions, "artifacts"> & { artifacts?: IArtifactWriter }) {
  return createAgent({ ...options, artifacts: options.artifacts ?? new RecordingArtifactWriter() });
}

class RecordingArtifactWriter implements IArtifactWriter {
  readonly writes = new Map<string, { reference: ArtifactRef; request: ArtifactWriteRequest }>();
  async write(request: ArtifactWriteRequest): Promise<ArtifactRef> {
    const prior = this.writes.get(request.idempotencyKey);
    if (prior) return prior.reference;
    const reference: ArtifactRef = {
      artifactId: `stored-${this.writes.size + 1}`,
      digest: hash(Buffer.from(request.data).toString()),
      byteLength: request.data.byteLength,
      mediaType: request.mediaType,
      schemaId: request.schemaId,
      schemaVersion: request.schemaVersion,
    };
    this.writes.set(request.idempotencyKey, { reference, request });
    return reference;
  }
}

const task = {
  goal: "Change the greeting to hello",
  acceptanceCriteria: ["Greeting is hello"],
  filePaths: ["greeting.txt"],
  sourceRefs: [],
};
const plan = { ...task, goal: "1. Read greeting.txt. 2. Write hello. 3. Run greeting check." };
const tool = (toolId: string, args: unknown = {}) => ({ kind: "tool", toolId, arguments: args });
const final = (value: unknown) => ({ kind: "final", value });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function statusFinal(request: ModelRequest) {
  const message = request.messages.at(-1);
  assert.ok(message);
  const observation = JSON.parse(message.text).observation.value;
  return final({ ...observation, summary: "Updated greeting." });
}
async function workspace(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "coding-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "greeting.txt"), "old");
  return root;
}
const check = {
  id: "greeting",
  command: process.execPath,
  args: [
    "-e",
    "if(require('node:fs').readFileSync('greeting.txt','utf8')!=='hello')process.exit(1)",
  ],
};

test("chat uses Codex CLI and saved-auth settings without an OpenAI API key", async (t) => {
  const root = await workspace(t);
  const executable = path.join(root, "codex-fixture.mjs");
  await copyFile(new URL("./CodexCliFixture.mjs", import.meta.url), executable);
  await chmod(executable, 0o700);
  const codexHome = path.join(root, "codex-home");
  await mkdir(codexHome);
  const keys = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_EXECUTABLE", "CODEX_HOME", "CODEX_MODEL"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  process.env.CODEX_EXECUTABLE = executable;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_MODEL = "codex-fixture-model";
  const progress: string[] = [];
  const result = await chat({
    artifacts: new RecordingArtifactWriter(),
    workspace: root,
    message: "Inspect greeting.txt without changing it.",
    files: [],
    signal: new AbortController().signal,
    progress: (message) => progress.push(message),
  });
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(result.result?.summary, "Inspected the greeting without changes.");
  assert.deepEqual(result.result?.changedPaths, []);
  assert.ok(progress.includes("Planning implementation."));
  assert.ok(progress.includes("Implementing accepted plan."));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("runs plan then edit with real workspace writes, command verification, and accepted plan context", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    tool("write_file", { path: "greeting.txt", content: "forbidden", expectedHash: hash("old") }),
    (request: ModelRequest) => {
      assert.equal(
        JSON.parse(request.messages.at(-1)!.text).observation.rejected,
        "TOOL_NOT_AVAILABLE",
      );
      return tool("read_file", { path: "greeting.txt" });
    },
    final(plan),
    (request: ModelRequest) => {
      assert.deepEqual(JSON.parse(request.messages[0]!.text).acceptedPlan, plan);
      return tool("write_file", {
        path: "greeting.txt",
        content: "hello",
        expectedHash: hash("old"),
      });
    },
    tool("run_check", { id: "greeting" }),
    tool("status"),
    statusFinal,
  ]);
  const artifacts = new RecordingArtifactWriter();
  const agent = createCodingAgent({ workspace: root, gateway, profile, checks: [check], artifacts });
  assert.ok(agent instanceof Agent);
  const result = await agent.run(task);
  assert.equal(result.outcome.status, "finished");
  if (result.outcome.status === "finished")
    assert.equal(result.outcome.outcome.status, "completed", JSON.stringify(result.snapshot));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
  assert.equal(await readFile(path.join(result.artifacts.workingCopy as string, "greeting.txt"), "utf8"), "hello");
  assert.deepEqual(
    result.snapshot.accepted.map((item) => item.stepId),
    ["plan", "edit"],
  );
  assert.equal(Object.keys(result.artifacts).length, 2);
  assert.equal(artifacts.writes.size, 1, "status and completion reuse the stored artifact");
  const stored = [...artifacts.writes.values()][0]!;
  assert.deepEqual(JSON.parse(new TextDecoder().decode(stored.request.data)), {
    path: "greeting.txt", before: "old", after: "hello",
  });
  assert.deepEqual(result.result?.changeArtifactRefs, [`artifact:${stored.reference.artifactId}`]);
  assert.deepEqual(result.artifacts[`artifact:${stored.reference.artifactId}`], stored.reference);
  assert.equal(result.result?.summary, "Updated greeting.");
  assert.equal(result.usage.reservations.filter((entry) => entry.requested.modelCalls).length, 7);
  assert.ok(result.journal.length > 0);
});

test("failed planning never starts editing", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway(["invalid action", "invalid action"]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task);
  assert.equal(result.snapshot.accepted.length, 0);
  assert.ok(result.snapshot.attempts.every((attempt) => attempt.claim.step.id === "plan"));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("does not accept implementation when required checks have not passed", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final(plan),
    tool("status"),
    statusFinal,
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    checks: [check],
    maxTurns: 2,
  }).run(task);
  assert.ok(!result.snapshot.accepted.some((item) => item.stepId === "edit"));
  assert.notEqual(result.snapshot.outcome?.status, "completed");
});

test("model budget exhaustion stops before dispatch", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([]);
  const result = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    limits: { modelCalls: 0 },
  }).run(task);
  assert.equal(gateway.requests.length, 0);
  assert.notEqual(result.snapshot.outcome?.status, "completed");
});

test("rejects symlink targets and leaves the linked file intact", async (t) => {
  const root = await workspace(t);
  const outside = path.join(root, "outside.txt");
  await writeFile(outside, "untouched");
  await symlink(outside, path.join(root, "link.txt"));
  const agent = createCodingAgent({ workspace: root, gateway: new ScriptedGateway([]), profile });
  await assert.rejects(agent.run({ ...task, filePaths: ["link.txt"] }), /Symlinks/);
  assert.equal(await readFile(outside, "utf8"), "untouched");
});

test("invalid task fails before model calls", async (t) => {
  const root = await workspace(t);
  const agent = createCodingAgent({ workspace: root, gateway: new ScriptedGateway([]), profile });
  await assert.rejects(agent.run({ ...task, filePaths: ["../outside.txt"] }), /request contract/);
  await assert.rejects(agent.run({ ...task, sourceRefs: ["external:unknown"] }), /External source/);
});

test("OpenAI composition uses Kushibot's real HTTP transport and reply mapper", async (t) => {
  const root = await workspace(t);
  let calls = 0;
  const actions = [final(plan), tool("status"), null];
  const http: typeof fetch = async (input, init) => {
    assert.equal(input, "https://api.openai.com/v1/responses");
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer test-key");
    const body = JSON.parse(init!.body as string);
    const next = actions[calls++];
    const action =
      next ??
      statusFinal({
        messages: body.input.map((item: { role: string; content: string }) => ({
          role: item.role,
          text: item.content,
        })),
      } as ModelRequest);
    return Response.json({
      id: "response_test",
      status: "completed",
      model: profile.modelId,
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(action) }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 100 },
    });
  };
  const result = await createOpenAiCodingAgent({ artifacts: new RecordingArtifactWriter(),
    workspace: root,
    apiKey: "test-key",
    profile,
    http,
  }).run(task);
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(calls, 3);
});

test("rejects paths outside the allowlist and stale write hashes", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final(plan),
    tool("write_file", { path: "other.txt", content: "no", expectedHash: null }),
    (request: ModelRequest) => {
      assert.match(JSON.parse(request.messages.at(-1)!.text).observation.value.error, /allowlist/);
      return tool("write_file", {
        path: "greeting.txt",
        content: "no",
        expectedHash: hash("wrong"),
      });
    },
    (request: ModelRequest) => {
      assert.match(
        JSON.parse(request.messages.at(-1)!.text).observation.value.error,
        /changed since/,
      );
      return tool("status");
    },
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task);
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
  await assert.rejects(readFile(path.join(root, "other.txt")), /ENOENT/);
});

test("rejects fabricated snapshot evidence and accepts corrected actual references", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final(plan),
    final({
      summary: "Fake",
      baseSnapshotRef: "snapshot:fake",
      resultSnapshotRef: "snapshot:fake",
      changedPaths: [],
      changeArtifactRefs: [],
      unresolved: [],
    }),
    (request: ModelRequest) => {
      assert.match(
        JSON.parse(request.messages.at(-1)!.text).observation.correction,
        /match status/,
      );
      return tool("status");
    },
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task);
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(result.snapshot.accepted.length, 2);
});

test("cancellation during a model call prevents editing", async (t) => {
  const root = await workspace(t);
  const controller = new AbortController();
  const gateway = new ScriptedGateway([
    () => {
      controller.abort();
      return final(plan);
    },
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task, {
    signal: controller.signal,
  });
  assert.equal(result.snapshot.outcome?.status, "stopped");
  assert.equal(result.snapshot.accepted.length, 0);
  assert.equal(gateway.requests.length, 1);
});

test("each run has fresh isolated state and emits phase progress", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final(plan),
    tool("status"),
    statusFinal,
    final(plan),
    tool("status"),
    statusFinal,
  ]);
  const agent = createCodingAgent({ workspace: root, gateway, profile });
  const progress: string[] = [];
  const first = await agent.run(task, {
    onProgress: (message) => {
      progress.push(message);
    },
  });
  const second = await agent.run(task);
  assert.notEqual(first.runId, second.runId);
  assert.equal(first.snapshot.outcome?.status, "completed");
  assert.equal(second.snapshot.outcome?.status, "completed");
  assert.deepEqual(progress, ["Planning implementation.", "Implementing accepted plan."]);
});

test("edits invalidate earlier passing checks", async (t) => {
  const root = await workspace(t);
  const attempt = [
    tool("run_check", { id: "greeting" }),
    tool("write_file", {
      path: "greeting.txt",
      content: "changed again",
      expectedHash: hash("hello"),
    }),
    tool("status"),
    (request: ModelRequest) => {
      const value = JSON.parse(request.messages.at(-1)!.text).observation.value;
      assert.match(value.unresolved[0], /has not passed/);
      return final({ ...value, unresolved: [] });
    },
  ];
  await writeFile(path.join(root, "greeting.txt"), "hello");
  const gateway = new ScriptedGateway([
    final(plan),
    ...attempt,
    tool("status"),
    statusFinal,
    tool("status"),
    statusFinal,
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    checks: [check],
    maxTurns: 4,
  }).run(task);
  assert.ok(!result.snapshot.accepted.some((item) => item.stepId === "edit"));
  assert.notEqual(result.snapshot.outcome?.status, "completed");
});

test("creates a new file and its permitted parent directories", async (t) => {
  const root = await workspace(t);
  const newTask = { ...task, filePaths: ["src/new/greeting.txt"] };
  const gateway = new ScriptedGateway([
    final({ ...plan, filePaths: newTask.filePaths }),
    tool("write_file", { path: "src/new/greeting.txt", content: "hello", expectedHash: null }),
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(newTask);
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(await readFile(path.join(result.artifacts.workingCopy as string, "src/new/greeting.txt"), "utf8"), "hello");
  await assert.rejects(readFile(path.join(root, "src/new/greeting.txt")));
});

test("run deadline terminates a running check command", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([final(plan), tool("run_check", { id: "wait" })]);
  const started = Date.now();
  const result = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    timeoutMs: 200,
    checks: [{ id: "wait", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] }],
  }).run(task);
  // The bounded dispatcher may return before the killed process has closed.
  // Such an in-flight operation is pending reconciliation, never successful.
  assert.ok(result.outcome.status === "pending" || result.snapshot.outcome?.status === "stopped");
  assert.ok(Date.now() - started < 3000);
  assert.ok(!result.snapshot.accepted.some((item) => item.stepId === "edit"));
});

test("discovers and edits workspace files without attachments while enforcing boundaries", async (t) => {
  const root = await workspace(t);
  await symlink(path.join(root, "greeting.txt"), path.join(root, "link.txt"));
  const gateway = new ScriptedGateway([
    tool("list_files", { path: "" }),
    (request: ModelRequest) => {
      const entries = JSON.parse(request.messages.at(-1)!.text).observation.value;
      assert.deepEqual(entries, [{ path: "greeting.txt", directory: false }]);
      return tool("read_file", { path: "greeting.txt" });
    },
    final(plan),
    tool("read_file", { path: "../outside.txt" }),
    (request: ModelRequest) => {
      assert.match(JSON.parse(request.messages.at(-1)!.text).observation.value.error, /outside/);
      return tool("read_file", { path: "link.txt" });
    },
    (request: ModelRequest) => {
      assert.match(JSON.parse(request.messages.at(-1)!.text).observation.value.error, /Symlinks/);
      return tool("write_file", { path: "greeting.txt", content: "hello", expectedHash: hash("old") });
    },
    tool("write_file", { path: "src/new.txt", content: "new", expectedHash: null }),
    tool("run_check", { id: "greeting" }),
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile, checks: [check] })
    .run({ ...task, filePaths: [] });
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.deepEqual(result.result?.changedPaths, ["greeting.txt", "src/new.txt"]);
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
  assert.equal(await readFile(path.join(result.artifacts.workingCopy as string, "greeting.txt"), "utf8"), "hello");
  assert.equal(await readFile(path.join(result.artifacts.workingCopy as string, "src/new.txt"), "utf8"), "new");
  await assert.rejects(readFile(path.join(root, "src/new.txt")));
});

test("tool budget exhaustion prevents workspace writes", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final(plan),
    tool("write_file", { path: "greeting.txt", content: "hello", expectedHash: hash("old") }),
  ]);
  const result = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    limits: { toolCalls: 0 },
  }).run(task);
  assert.equal(result.snapshot.outcome?.status, "stopped");
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
  assert.deepEqual(Object.keys(result.artifacts), ["workingCopy"]);
});

test("planning denies every editing capability and advertises only read tools", async (t) => {
  const root = await workspace(t);
  const rejected = (request: ModelRequest) => {
    assert.equal(JSON.parse(request.messages.at(-1)!.text).observation.rejected, "TOOL_NOT_AVAILABLE");
  };
  const gateway = new ScriptedGateway([
    (request: ModelRequest) => {
      const instructions = request.instructions;
      assert.match(instructions, /list_files/);
      assert.match(instructions, /read_file/);
      assert.doesNotMatch(instructions, /write_file|run_check|status \{\}/);
      return tool("write_file", { path: "greeting.txt", content: "forbidden", expectedHash: hash("old") });
    },
    (request: ModelRequest) => { rejected(request); return tool("run_check", { id: "greeting" }); },
    (request: ModelRequest) => { rejected(request); return tool("status"); },
    (request: ModelRequest) => { rejected(request); return final(plan); },
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task);
  assert.equal(result.snapshot.outcome?.status, "completed");
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("library dispatcher validates arguments and scope, then replays writes without charging twice", async (t) => {
  const root = await workspace(t);
  const runtime = await new AgentRuntimeFactory({ gateway: new ScriptedGateway([]), profile }).create("coding");
  const tools = new WorkspaceTools(root, ["greeting.txt"], [], runtime, new RecordingArtifactWriter());
  await tools.initialize();
  const dispatcher = tools.bind(false);
  const dispatch = (id: string, toolId: string, args: unknown) => dispatcher.dispatch(
    { operationId: id, toolId, arguments: args },
    { ...runtime.context, identity: { ...runtime.context.identity, operationId: id } },
  );
  assert.deepEqual(await dispatch("invalid", "write_file", { path: "greeting.txt", content: "oops" }),
    { status: "rejected", code: "TOOL_ARGUMENTS_INVALID" });
  assert.deepEqual(await dispatcher.dispatch(
    { operationId: "scope", toolId: "status", arguments: {} },
    { ...runtime.context, scope: { ...runtime.context.scope, projectId: "other" },
      identity: { ...runtime.context.identity, operationId: "scope" } },
  ), { status: "rejected", code: "TOOL_SCOPE_OR_ID_INVALID" });

  const args = { path: "greeting.txt", content: "hello", expectedHash: hash("old") };
  const first = await dispatch("write-once", "write_file", args);
  assert.equal(first.status, "completed");
  const replay = await dispatch("write-once", "write_file", args);
  assert.equal(replay.status, "completed");
  if (first.status === "completed" && replay.status === "completed") {
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.observation, first.observation);
    assert.deepEqual({ ...replay.observation.value as Record<string, unknown> }, { written: "greeting.txt", hash: hash("hello") });
  }
  const ledger = await runtime.stores.usage.read();
  assert.equal(ledger.reservations.filter((entry) => entry.requested.toolCalls).length, 1);
  await assert.rejects(dispatch("write-once", "write_file", { ...args, content: "different" }));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "hello");
});

test("library tools return recoverable workspace errors as observations", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    tool("list_files", { path: "../outside" }),
    (request: ModelRequest) => {
      assert.match(JSON.parse(request.messages.at(-1)!.text).observation.value.error, /allowlist/);
      return final(plan);
    },
    tool("status"),
    statusFinal,
  ]);
  const result = await createCodingAgent({ workspace: root, gateway, profile }).run(task);
  assert.equal(result.snapshot.outcome?.status, "completed");
});


test("change artifacts survive SQLite reopen and retain store references", async (t) => {
  const root = await workspace(t);
  const directory = path.join(root, "artifact-database");
  let artifacts = await LocalChatArtifacts.open(root, directory);
  let reference: ArtifactRef;
  try {
    const gateway = new ScriptedGateway([
      final(plan),
      tool("write_file", { path: "greeting.txt", content: "hello", expectedHash: hash("old") }),
      tool("status"), statusFinal,
    ]);
    const result = await createCodingAgent({
      workspace: root, gateway, profile, artifacts: artifacts.services.store,
    }).run(task);
    assert.equal(result.snapshot.outcome?.status, "completed");
    const key = result.result!.changeArtifactRefs[0]!;
    reference = result.artifacts[key] as unknown as ArtifactRef;
    assert.equal(key, `artifact:${reference.artifactId}`);
  } finally {
    await artifacts.close();
  }
  artifacts = await LocalChatArtifacts.open(root, directory);
  try {
    const stored = await artifacts.services.store.read(reference!, 1_048_576);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(stored.data)), {
      path: "greeting.txt", before: "old", after: "hello",
    });
  } finally {
    await artifacts.close();
  }
});

test("artifact write failure cannot produce accepted change evidence", async (t) => {
  const root = await workspace(t);
  const evidence = new WorkspaceEvidence((file): Promise<string | null> => reader.read(file), [], {
    write: async () => { throw new Error("Store unavailable"); },
  }, "test-run", new AbortController().signal);
  const reader = new ReadFileTool(root, ["greeting.txt"], (file, content) => evidence.track(file, content));
  await evidence.initialize(["greeting.txt"]);
  await writeFile(path.join(root, "greeting.txt"), "hello");
  await assert.rejects(evidence.status(), /Store unavailable/);
  assert.deepEqual(evidence.evidence(), {});
});
