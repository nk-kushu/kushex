import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import { expect, it } from "vitest";
import { recorded } from "../../test/debugEvents";
import { buildTrace } from "./debugTrace";
import { buildContextModel } from "./contextModel";

let sequence = 0;
function at(
  span: string,
  parent: string | null,
  type: string,
  payload: DebugEventDto["payload"],
): RecordedDebugEventDto {
  const item = recorded(++sequence, type, "debug", payload);
  return {
    ...item,
    event: { ...item.event, trace: { ...item.event.trace, spanId: span, parentSpanId: parent } },
  };
}

/** A plan session of two turns: a tool call that writes an artifact, then a final result. */
function run(measured: boolean): RecordedDebugEventDto[] {
  sequence = 0;
  const window = (count: number, extra: Record<string, number>, refs: string[]) =>
    measured
      ? [
          at(`turn${count}`, "mind", "progress.reported", {
            operation: "context.window",
            nextState: "fits",
            count: count * 2 - 1,
            relatedRefs: refs,
            metrics: {
              instructionsBytes: 1000,
              taskBytes: 200,
              messages: count * 2 - 1,
              tokenUpperBound: 3000,
              maxOutputTokens: 1000,
              contextTokens: 11_000,
              ...extra,
            },
          }),
        ]
      : [];
  const reply = (span: string, input: number) =>
    at(span, `t${span}`, "progress.reported", {
      operation: "model.reply",
      nextState: "completed",
      relatedRefs: [
        "model:x/y",
        `inputTokens:${input}`,
        "outputTokens:10",
        "cachedInputTokens:500",
      ],
    });
  return [
    at("run", "root", "operation.started", { operation: "agent.run" }),
    at("step", "run", "operation.started", {
      operation: "workflow.step",
      relatedRefs: ["step:plan"],
    }),
    at("exec", "step", "operation.started", {
      operation: "executor.run",
      relatedRefs: ["executor:plan@1"],
    }),
    at("exec", "step", "progress.reported", {
      operation: "agent.session",
      relatedRefs: ["session:s1", "mode:structured"],
      metrics: { instructionsBytes: 900, inputBytes: 150 },
    }),
    at("mind", "exec", "operation.started", {
      operation: "mind-unit.run",
      relatedRefs: ["session:s1"],
    }),
    at("turn1", "mind", "operation.started", { operation: "session.turn", count: 1 }),
    ...window(1, { assistantBytes: 0, observationBytes: 0 }, ["msg:1:task:task:200"]),
    at("m1", "turn1", "operation.started", { operation: "model.call" }),
    reply("m1", 1000),
    at("m1", "turn1", "operation.completed", { operation: "model.call", durationMs: 5 }),
    at("turn1", "mind", "progress.reported", {
      operation: "session.action",
      nextState: "tool",
      relatedRefs: ["tool:read_file"],
    }),
    at("tool1", "turn1", "operation.started", {
      operation: "tool.call",
      relatedRefs: ["tool:read_file"],
    }),
    at("art1", "tool1", "operation.started", {
      operation: "artifact.write",
      relatedRefs: ["kind:workspace-change"],
    }),
    at("art1", "tool1", "result.persisted", {
      operation: "artifact.stored",
      relatedRefs: ["artifact:a-123456789", "kind:workspace-change"],
      metrics: { bytes: 4096 },
    }),
    at("art1", "tool1", "operation.completed", { operation: "artifact.write", durationMs: 1 }),
    at("tool1", "turn1", "progress.reported", {
      operation: "tool.outcome",
      nextState: "completed",
    }),
    at("tool1", "turn1", "operation.completed", { operation: "tool.call", durationMs: 2 }),
    at("turn1", "mind", "operation.completed", { operation: "session.turn", durationMs: 10 }),
    at("turn2", "mind", "operation.started", { operation: "session.turn", count: 2 }),
    ...window(2, { assistantBytes: 50, observationBytes: 750, "obs.tool.read_file": 750 }, [
      "added:tool.read_file",
      "msg:1:task:task:200",
      "msg:2:assistant:tool.read_file:50",
      "msg:3:observation:tool.read_file:750",
    ]),
    at("m2", "turn2", "operation.started", { operation: "model.call" }),
    reply("m2", 1400),
    at("m2", "turn2", "operation.completed", { operation: "model.call", durationMs: 5 }),
    at("turn2", "mind", "progress.reported", { operation: "session.action", nextState: "final" }),
    at("turn2", "mind", "policy.applied", {
      operation: "session.acceptance",
      nextState: "accepted",
      metrics: { resultBytes: 321 },
    }),
    at("turn2", "mind", "operation.completed", { operation: "session.turn", durationMs: 10 }),
    at("mind", "exec", "operation.completed", { operation: "mind-unit.run", durationMs: 30 }),
    at("run", "root", "result.persisted", {
      operation: "artifacts.collected",
      count: 1,
      relatedRefs: ["artifact:a-123456789"],
      metrics: { artifacts: 1, bytes: 4096 },
    }),
  ];
}

it("measures each turn's context by origin and splits off what the turn appended", () => {
  const events = run(true);
  const model = buildContextModel(buildTrace(events), events);
  expect(model.measured).toBe(true);
  const [session] = model.sessions;
  expect(session).toMatchObject({
    sessionId: "s1",
    step: "plan",
    mode: "structured",
    inputBytes: 150,
    resultBytes: 321,
  });
  const second = session!.turns[1]!;
  expect(second.unit).toBe("bytes");
  expect(second.total).toBe(2000);
  expect(second.fill).toBeCloseTo(0.3);
  expect(second.segments.filter((s) => s.added).map((s) => [s.key, s.value])).toEqual([
    ["assistant", 50],
    ["obs.tool.read_file", 750],
  ]);
  expect(second.messageList.filter((m) => m.added).map((m) => m.index)).toEqual([2, 3]);
  expect(second.usage).toEqual({ input: 1400, cached: 500, output: 10, reasoning: 0 });
  expect(session!.turns[0]!.artifacts).toMatchObject([{ id: "a-123456789", bytes: 4096, turn: 1 }]);
  expect(model.artifacts).toHaveLength(1);
  expect(model.collected).toEqual({ count: 1, bytes: 4096 });
  expect(model.compressions).toEqual([]);
});

it("estimates the composition from token growth for runs without context events", () => {
  const events = run(false);
  const model = buildContextModel(buildTrace(events), events);
  expect(model.measured).toBe(false);
  const [first, second] = model.sessions[0]!.turns;
  expect(first!.segments).toMatchObject([{ key: "base", value: 1000 }]);
  expect(second!.unit).toBe("tokens");
  expect(second!.total).toBe(1400);
  expect(second!.segments.at(-1)).toMatchObject({
    key: "obs.tool.read_file",
    value: 400,
    added: true,
  });
});
