#!/usr/bin/env node
// Offline Codex CLI fixture for the chat entry point; no provider calls or auth reads.
import assert from "node:assert/strict";

const args = process.argv.slice(2);
assert.equal(args[args.indexOf("--model") + 1], "codex-fixture-model");
assert.ok(process.env.CODEX_HOME.endsWith("codex-home"));
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.CODEX_API_KEY, undefined);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const { messages } = JSON.parse(stdin);
const instructions = JSON.parse(args.find((arg) => arg.startsWith("developer_instructions=")).split("=").slice(1).join("="));
let action;
if (instructions.includes("Return a TaskInput object:")) {
  const { task } = JSON.parse(messages[0].text);
  action = { kind: "final", value: { ...task, goal: "1. Inspect the permitted greeting file." } };
} else if (messages.length === 1) {
  assert.ok(JSON.parse(messages[0].text).acceptedPlan);
  action = { kind: "tool", toolId: "status", arguments: {} };
} else {
  const actual = JSON.parse(messages.at(-1).text).observation.value;
  action = { kind: "final", value: { ...actual, summary: "Inspected the greeting without changes." } };
}
for (const event of [
  { type: "thread.started", thread_id: "codex_fixture" },
  { type: "turn.started" },
  { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(action) } },
  { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 100 } },
]) process.stdout.write(JSON.stringify(event) + "\n");
