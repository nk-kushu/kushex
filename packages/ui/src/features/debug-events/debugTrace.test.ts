import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import { expect, it } from "vitest";
import { recorded } from "../../test/debugEvents";
import { buildTrace, describeEvent, matchingSpans, traceStats, visibleSpans } from "./debugTrace";

let sequence = 0;
/** An event in span `span` whose parent is `parent`. */
function at(
  span: string,
  parent: string | null,
  type: string,
  payload: DebugEventDto["payload"],
  level: DebugEventDto["level"] = "debug",
): RecordedDebugEventDto {
  const item = recorded(++sequence, type, level, payload);
  return {
    ...item,
    event: { ...item.event, trace: { ...item.event.trace, spanId: span, parentSpanId: parent } },
  };
}

const events = [
  at("run", "root", "operation.started", {
    operation: "agent.run",
    relatedRefs: ["agent:coding", "workflow:coding@1"],
  }),
  at(
    "run",
    "root",
    "progress.reported",
    { operation: "workflow.plan", count: 1, relatedRefs: ["step:plan=executor:investigate@1"] },
    "info",
  ),
  at("step", "run", "operation.started", {
    operation: "workflow.step",
    relatedRefs: ["step:plan"],
  }),
  at(
    "step",
    "run",
    "progress.reported",
    {
      operation: "step.attempt",
      count: 1,
      relatedRefs: ["step:plan", "attempt:1/3", "executor:investigate@1"],
    },
    "info",
  ),
  at("exec", "step", "operation.started", {
    operation: "executor.run",
    relatedRefs: ["executor:investigate@1"],
  }),
  at("mind", "exec", "operation.started", {
    operation: "mind-unit.run",
    relatedRefs: ["session:s1"],
  }),
  at("turn", "mind", "operation.started", {
    operation: "session.turn",
    count: 1,
    relatedRefs: ["turn:1/30"],
  }),
  at("model", "turn", "operation.started", { operation: "model.call" }),
  at("model", "turn", "progress.reported", {
    operation: "model.reply",
    nextState: "completed",
    relatedRefs: ["model:codex/gpt", "inputTokens:1200", "outputTokens:30"],
  }),
  at("model", "turn", "operation.completed", { operation: "model.call", durationMs: 40 }),
  at(
    "turn",
    "mind",
    "progress.reported",
    { operation: "session.action", nextState: "tool", relatedRefs: ["tool:read_file"] },
    "info",
  ),
  at("tool", "turn", "operation.started", {
    operation: "tool.call",
    relatedRefs: ["tool:read_file"],
  }),
  at(
    "tool",
    "turn",
    "progress.reported",
    {
      operation: "tool.outcome",
      nextState: "rejected",
      code: "DENIED",
      relatedRefs: ["tool:read_file"],
    },
    "warn",
  ),
  at("tool", "turn", "operation.completed", { operation: "tool.call", durationMs: 5 }),
  at("turn", "mind", "operation.completed", { operation: "session.turn", durationMs: 60 }),
  at("mind", "exec", "operation.completed", { operation: "mind-unit.run", durationMs: 70 }),
  at("exec", "step", "operation.completed", { operation: "executor.run", durationMs: 80 }),
  // Reported after the executor ended, so it lands in the step span.
  at(
    "step",
    "run",
    "progress.reported",
    {
      operation: "executor.outcome",
      nextState: "completed",
      relatedRefs: ["executor:investigate@1"],
    },
    "info",
  ),
  at(
    "step",
    "run",
    "policy.applied",
    { operation: "step.acceptance", nextState: "accepted" },
    "info",
  ),
  at("step", "run", "operation.completed", { operation: "workflow.step", durationMs: 90 }),
  at("run", "root", "operation.completed", { operation: "agent.run", durationMs: 100 }),
  at(
    "root",
    null,
    "progress.reported",
    { operation: "agent.outcome", nextState: "completed" },
    "info",
  ),
];

it("nests spans run > step > executor > mind unit > turn > model/tool calls", () => {
  const root = buildTrace(events);
  const rows = visibleSpans(root, new Set());
  expect(rows.map((span) => [span.depth, span.kind, span.title])).toEqual([
    [1, "run", "Agent coding"],
    [2, "step", "Step “plan”"],
    [3, "executor", "Executor investigate@1"],
    [4, "mind", "Agentic mind unit"],
    [5, "turn", "Turn 1/30"],
    [6, "model", "Model call"],
    [6, "tool", "Tool read_file"],
  ]);
  const of = (kind: string) => rows.find((span) => span.kind === kind)!;
  const run = of("run");
  const step = of("step");
  const executor = of("executor");
  const turn = of("turn");
  const model = of("model");
  const tool = of("tool");
  expect(run.badges.map((badge) => badge.text)).toEqual(["completed"]);
  expect(step.subtitle).toBe("attempt 1/3 · → investigate@1");
  expect(step.badges.map((badge) => badge.text)).toEqual(["accepted"]);
  expect(executor.badges.map((badge) => badge.text)).toEqual(["completed"]);
  expect(turn.subtitle).toBe("calls tool read_file");
  expect(model.subtitle).toBe("codex/gpt");
  expect(tool.status).toBe("warn");
});

it("describes events in plain words and totals the run", () => {
  const action = events.find((item) => item.event.payload.operation === "session.action")!;
  const outcome = events.find((item) => item.event.payload.operation === "tool.outcome")!;
  expect(describeEvent(action.event).text).toBe("Model chose to call tool read_file");
  expect(describeEvent(outcome.event).text).toBe("Tool read_file rejected (DENIED)");
  const root = buildTrace(events);
  expect(traceStats(root, events)).toMatchObject({
    steps: 1,
    turns: 1,
    modelCalls: 1,
    toolCalls: 1,
    inputTokens: 1200,
    outputTokens: 30,
    warnings: 1,
    models: ["codex/gpt"],
  });
});

it("finds spans by text, keeping their ancestors", () => {
  const root = buildTrace(events);
  const keep = matchingSpans(root, "read_file");
  expect(visibleSpans(root, new Set(), keep ?? undefined).map((span) => span.kind)).toEqual([
    "run",
    "step",
    "executor",
    "mind",
    "turn",
    "tool",
  ]);
});
