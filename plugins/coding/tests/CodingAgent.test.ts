import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AgentRuntimeFactory,
  type ArtifactRef,
  type ArtifactWriteRequest,
  type IArtifactWriter,
  type IExecutionContext,
  type ModelRequest,
} from "kushibot";
import { WorkspaceTools } from "../src/tools/WorkspaceTools";
import { CliWorkspace } from "../src/infrastructure/workspace/CliWorkspace";
import { SandboxedCli } from "../src/infrastructure/sandbox/SandboxedCli";
import { createCodingAgent } from "../src/composition/createCodingAgent";
import { chat } from "../agent";
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

const task = {
  goal: "Change the greeting",
  acceptanceCriteria: ["Greeting is hello"],
  filePaths: ["greeting.txt"],
  sourceRefs: [],
};
const plan = { ...task, goal: "Inspect and update greeting.txt, then verify." };
const cli = (command: string) => ({ kind: "tool", toolId: "cli", arguments: { command } });
const final = (value: unknown) => ({ kind: "final", value });
const finish = (request: ModelRequest) => {
  const observation = JSON.parse(request.messages.at(-1)!.text).observation.value;
  assert.equal(observation.error, undefined, JSON.stringify(observation));
  return final({ ...observation.status, summary: "Updated greeting." });
};

async function workspace(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "coding-cli-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "greeting.txt"), "old");
  return root;
}

async function context(signal = new AbortController().signal): Promise<IExecutionContext> {
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding", { signal });
  return runtime.context;
}

test("only cli is exposed and planning has a read-only workspace", async (t) => {
  const root = await workspace(t);
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding");
  const tools = new WorkspaceTools(root, [], [], runtime, new RecordingArtifactWriter());
  await tools.initialize();
  assert.match(tools.description(true), /cli/);
  assert.doesNotMatch(tools.description(true), /list_files|read_file|write_file|run_check/);
  const result = await new SandboxedCli().run(
    root,
    ["/bin/sh", "-c", "printf forbidden > greeting.txt"],
    true,
    runtime.context,
  );
  assert.notEqual(result.exitCode, 0);
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("sandbox cannot read host files, inherit credentials, use network, or write outside workspace", async (t) => {
  const root = await workspace(t);
  const outside = path.join(path.dirname(root), `${path.basename(root)}-secret`);
  await writeFile(outside, "secret");
  t.after(() => rm(outside, { force: true }));
  process.env.KUSHEX_CLI_TEST_SECRET = "must-not-be-visible";
  t.after(() => {
    delete process.env.KUSHEX_CLI_TEST_SECRET;
  });
  const script = `
    const fs = require('node:fs');
    const net = require('node:net');
    const assert = require('node:assert/strict');
    assert.equal(process.env.KUSHEX_CLI_TEST_SECRET, undefined);
    assert.throws(() => fs.readFileSync(${JSON.stringify(outside)}));
    assert.throws(() => fs.writeFileSync('/usr/escape', 'no'));
    assert.throws(() => fs.readFileSync('/codex/auth.json'));
    const socket = net.connect({host:'1.1.1.1', port:80});
    socket.on('connect', () => process.exit(2));
    socket.on('error', () => { console.log('isolated'); });
    setTimeout(() => { socket.destroy(); console.log('isolated'); }, 150);
  `;
  const result = await new SandboxedCli().run(
    root,
    [process.execPath, "-e", script],
    false,
    await context(),
  );
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /isolated/);
  assert.equal(await readFile(outside, "utf8"), "secret");
});

test("restricted tasks cannot read other workspace files or retain unauthorized additions", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "other.txt"), "secret");
  const projection = new CliWorkspace(root, ["greeting.txt", "new.txt"]);
  const sandbox = new SandboxedCli();
  const execution = await context();
  const result = await projection.execute(false, (directory) =>
    sandbox.run(
      directory,
      [
        "/bin/sh",
        "-c",
        "test ! -e other.txt && printf hello > greeting.txt && printf new > new.txt",
      ],
      false,
      execution,
    ),
  );
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "hello");
  await assert.rejects(
    projection.execute(false, (directory) =>
      sandbox.run(directory, ["/bin/sh", "-c", "printf forbidden > other.txt"], false, execution),
    ),
    /outside the task allowlist/,
  );
  assert.equal(await readFile(path.join(root, "other.txt"), "utf8"), "secret");
});

test("plan then CLI editing updates the supplied workspace and automatically verifies checks", async (t) => {
  const root = await workspace(t);
  const artifacts = new RecordingArtifactWriter();
  const gateway = new ScriptedGateway([
    cli("cat greeting.txt"),
    final(plan),
    cli("printf hello > greeting.txt"),
    finish,
  ]);
  const run = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    artifacts,
    checks: [
      { id: "greeting", command: "/bin/sh", args: ["-c", 'test "$(cat greeting.txt)" = hello'] },
    ],
  }).run(task);
  assert.equal(run.snapshot.outcome?.status, "completed", JSON.stringify(run.snapshot));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "hello");
  assert.equal("workingCopy" in run.artifacts, false);
  assert.deepEqual(run.result?.changedPaths, ["greeting.txt"]);
  assert.deepEqual(run.result?.unresolved, []);
  assert.equal(artifacts.writes.size, 1);
  assert.deepEqual(
    JSON.parse(Buffer.from([...artifacts.writes.values()][0]!.request.data).toString()),
    { path: "greeting.txt", before: "old", after: "hello" },
  );
});

test("CLI tracks new and deleted files without prior file-tool reads", async (t) => {
  const root = await workspace(t);
  const gateway = new ScriptedGateway([
    final({ ...plan, filePaths: [] }),
    cli("rm greeting.txt && mkdir src && printf hello > src/new.txt"),
    finish,
  ]);
  const run = await createCodingAgent({
    workspace: root,
    gateway,
    profile,
    artifacts: new RecordingArtifactWriter(),
  }).run({ ...task, filePaths: [] });
  assert.equal(run.snapshot.outcome?.status, "completed", JSON.stringify(run.snapshot));
  assert.deepEqual(run.result?.changedPaths, ["greeting.txt", "src/new.txt"]);
  await assert.rejects(readFile(path.join(root, "greeting.txt")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "src/new.txt"), "utf8"), "hello");
});

test("failed checks remain unresolved and an earlier success does not cover a later edit", async (t) => {
  const root = await workspace(t);
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding");
  const tools = new WorkspaceTools(
    root,
    ["greeting.txt"],
    [{ id: "greeting", command: "/bin/sh", args: ["-c", 'test "$(cat greeting.txt)" = hello'] }],
    runtime,
    new RecordingArtifactWriter(),
  );
  await tools.initialize();
  const dispatcher = tools.bind(false);
  const execute = (id: string, command: string) =>
    dispatcher.dispatch(
      { operationId: id, toolId: "cli", arguments: { command } },
      { ...runtime.context, identity: { ...runtime.context.identity, operationId: id } },
    );
  assert.equal((await execute("write-hello", "printf hello > greeting.txt")).status, "completed");
  assert.deepEqual((await tools.status()).unresolved, []);
  await execute("write-bad", "printf bad > greeting.txt");
  assert.match((await tools.status()).unresolved[0]!, /has not passed/);
});

test("CLI rejects malformed arguments and completed operations replay without rerunning", async (t) => {
  const root = await workspace(t);
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding");
  const tools = new WorkspaceTools(root, [], [], runtime, new RecordingArtifactWriter());
  await tools.initialize();
  const dispatcher = tools.bind(false);
  const dispatch = (id: string, args: unknown) =>
    dispatcher.dispatch(
      { operationId: id, toolId: "cli", arguments: args },
      { ...runtime.context, identity: { ...runtime.context.identity, operationId: id } },
    );
  assert.deepEqual(await dispatch("bad", {}), {
    status: "rejected",
    code: "TOOL_ARGUMENTS_INVALID",
  });
  const call = {
    operationId: "append-once",
    toolId: "cli",
    arguments: { command: "printf x >> greeting.txt" },
  };
  const first = await dispatch(call.operationId, call.arguments);
  assert.equal(first.status, "completed");
  const replay = await dispatch(call.operationId, call.arguments);
  assert.equal(replay.status, "completed");
  if (first.status === "completed" && replay.status === "completed") {
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.observation, first.observation);
  }
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "oldx");
});

test("CLI output is bounded and cancellation terminates its sandbox", async (t) => {
  const root = await workspace(t);
  const sandbox = new SandboxedCli();
  const output = await sandbox.run(
    root,
    [process.execPath, "-e", "process.stdout.write('x'.repeat(100000))"],
    true,
    await context(),
  );
  assert.equal(output.exitCode, 0, output.output);
  assert.equal(output.truncated, true);
  assert.equal(Buffer.byteLength(output.output), 16_384);
  const controller = new AbortController();
  const execution = await context(controller.signal);
  const pending = sandbox.run(
    root,
    ["/bin/sh", "-c", "sleep 30; printf escaped > greeting.txt"],
    false,
    execution,
  );
  const timer = setTimeout(() => controller.abort(), 150);
  const result = await pending;
  clearTimeout(timer);
  assert.notEqual(result.exitCode, 0);
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("background descendants cannot continue editing after CLI returns", async (t) => {
  const root = await workspace(t);
  const result = await new SandboxedCli().run(
    root,
    ["/bin/sh", "-c", "(sleep 0.2; printf escaped > greeting.txt) >/dev/null 2>&1 &"],
    false,
    await context(),
  );
  assert.equal(result.exitCode, 0, result.output);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("review rejects symlinks and unsupported binary files", async (t) => {
  const root = await workspace(t);
  await symlink("/etc/passwd", path.join(root, "link"));
  await assert.rejects(new CliWorkspace(root, ["link"]).read("link"), /Symlink/);
  await writeFile(path.join(root, "binary"), Buffer.from([0, 1]));
  await assert.rejects(new CliWorkspace(root, ["binary"]).read("binary"), /binary/);
});

test("the CLI cannot see the backend source mount", async (t) => {
  const root = await workspace(t);
  const result = await new SandboxedCli().run(
    root,
    ["/bin/sh", "-c", "test ! -e /source/kushex/package.json"],
    true,
    await context(),
  );
  assert.equal(result.exitCode, 0, result.output);
});

test("unchanged binary and large files do not block coding; unsupported changes cannot be accepted", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "image.bin"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(root, "large.lock"), "x".repeat(100_000));
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding");
  const tools = new WorkspaceTools(root, [], [], runtime, new RecordingArtifactWriter());
  await tools.initialize();
  assert.deepEqual((await tools.status()).changedPaths, []);
  await writeFile(path.join(root, "large.lock"), "modified");
  await assert.rejects(tools.status(), /unsupported by change review/);
});

test("planning mount and dependency mounts cannot be made writable in nested namespaces", async (t) => {
  const root = await workspace(t);
  const sandbox = new SandboxedCli();
  const result = await sandbox.run(
    root,
    [
      "/bin/sh",
      "-c",
      "unshare -Urnm /bin/sh -c 'mount -o remount,rw /workspace && printf escaped > /workspace/greeting.txt'",
    ],
    true,
    await context(),
  );
  assert.notEqual(result.exitCode, 0, result.output);
  assert.equal(await readFile(path.join(root, "greeting.txt"), "utf8"), "old");
});

test("chat returns the standard message envelope through the Codex CLI adapter", async (t) => {
  const root = await workspace(t);
  const executable = path.join(root, "codex-fixture.mjs");
  await copyFile(new URL("./fixtures/CodexCliFixture.mjs", import.meta.url), executable);
  await chmod(executable, 0o700);
  const codexHome = path.join(root, "codex-home");
  await mkdir(codexHome);
  const keys = [
    "CODEX_EXECUTABLE",
    "CODEX_HOME",
    "CODEX_MODEL",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.CODEX_EXECUTABLE = executable;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_MODEL = "codex-fixture-model";
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  const response = await chat({
    workspace: root,
    message: "Inspect the greeting.",
    files: [],
    artifacts: new RecordingArtifactWriter(),
    signal: new AbortController().signal,
    progress: () => {},
  });
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.message, "Inspected the greeting without changes.");
  assert.equal(response.presentation, "message");
  assert.equal(response.snapshot.outcome?.status, "completed");
});
