import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRuntimeFactory } from "kushibot";
import { SandboxedCli } from "../src/infrastructure/sandbox/SandboxedCli";
import { ScriptedGateway, profile } from "./fixtures/ScriptedGateway";

// Run this file in a container using Docker's DEFAULT seccomp profile.
test("an unavailable namespace sandbox fails without executing on the host", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-unavailable-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "marker"), "unchanged");
  const runtime = await new AgentRuntimeFactory({
    gateway: new ScriptedGateway([]),
    profile,
  }).create("coding");
  const result = await new SandboxedCli().run(
    root,
    ["/bin/sh", "-c", "printf escaped > marker"],
    false,
    runtime.context,
  );
  assert.notEqual(result.exitCode, 0, result.output);
  assert.match(result.output, /bwrap:/);
  assert.equal(await readFile(path.join(root, "marker"), "utf8"), "unchanged");
});
