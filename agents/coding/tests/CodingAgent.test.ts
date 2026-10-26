import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, type IModelGateway, type ModelProfile, type ModelRequest } from "kushibot";
import createCodingAgent, { createOpenAiCodingAgent } from "../agent";

const profile: ModelProfile = {
  id: "coding-test",
  providerId: "openai",
  modelId: "test-model",
  contextTokens: 100_000,
  maxOutputTokens: 4096,
  maxRequestBytes: 1_048_576,
  maxResponseBytes: 1_048_576,
  supportsPromptCacheKey: false,
};
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

type Action = unknown | ((request: ModelRequest) => unknown);
class ScriptedGateway implements IModelGateway {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly actions: Action[]) {}
  async generate(request: ModelRequest) {
    this.requests.push(request);
    const action = this.actions.shift();
    assert.notEqual(action, undefined, "Unexpected model call");
    return {
      status: "completed" as const,
      text: typeof action === "function" ? JSON.stringify(action(request)) : JSON.stringify(action),
      providerId: profile.providerId,
      modelId: profile.modelId,
      responseId: "test-response",
      errorCode: null,
      usage: {
        inputTokens: 100,
        outputTokens: 100,
        cachedInputTokens: null,
        reasoningTokens: null,
      },
    };
  }
}
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

test("runs plan then edit with real workspace writes, command verification, and accepted plan context", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    tool("write_file", { path: "greeting.txt", content: "forbidden", expectedHash: hash("old") }),
    (request: ModelRequest) => {
      assert.equal(
        JSON.parse(request.messages.at(-1)!.text).observation.rejected,
        "READ_ONLY_PLANNING",
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
  const agent = createCodingAgent({ workspace: root, gateway, profile, checks: [check] });
  assert.ok(agent instanceof Agent);
  const result = await agent.run(task);
  assert.equal(result.outcome.status, "finished");
  if (result.outcome.status === "finished")
    assert.equal(result.outcome.outcome.status, "completed", JSON.stringify(result.snapshot));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "hello");
  assert.deepEqual(
    result.snapshot.accepted.map((item) => item.stepId),
    ["plan", "edit"],
  );
  assert.equal(Object.keys(result.artifacts).length, 1);
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
  const result = await createOpenAiCodingAgent({
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
  assert.equal(await readFile(path.join(root, "src/new/greeting.txt"), "utf8"), "hello");
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
  assert.equal(result.snapshot.outcome?.status, "stopped");
  assert.ok(Date.now() - started < 3000);
  assert.ok(!result.snapshot.accepted.some((item) => item.stepId === "edit"));
});
