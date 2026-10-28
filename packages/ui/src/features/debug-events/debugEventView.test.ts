import { expect, it } from "vitest";
import { recorded } from "../../test/debugEvents";
import { countByLevel, filterEvents, formatDuration, formatOffset } from "./debugEventView";

const events = [
  recorded(1, "operation.started", "debug", { operation: "model.call" }),
  recorded(2, "operation.completed", "debug", { operation: "model.call", durationMs: 812 }),
  recorded(3, "progress.reported", "info", { summary: "Reading the files" }),
  recorded(4, "progress.reported", "warn", {
    operation: "tool.outcome",
    nextState: "rejected",
    relatedRefs: ["tool:write"],
  }),
];

it("hides span starts unless asked, and filters by level and text", () => {
  const all = { minLevel: "trace", query: "", spans: true } as const;
  expect(filterEvents(events, all)).toHaveLength(4);
  expect(filterEvents(events, { ...all, spans: false }).map((item) => item.sequence)).toEqual([
    2, 3, 4,
  ]);
  expect(filterEvents(events, { ...all, minLevel: "info" }).map((item) => item.sequence)).toEqual([
    3, 4,
  ]);
  expect(
    filterEvents(events, { ...all, query: "TOOL:WRITE" }).map((item) => item.sequence),
  ).toEqual([4]);
  expect(filterEvents(events, { ...all, query: "reading" }).map((item) => item.sequence)).toEqual([
    3,
  ]);
});

it("formats offsets and durations", () => {
  expect(formatOffset(0)).toBe("+0.000s");
  expect(formatOffset(12_345)).toBe("+12.345s");
  expect(formatOffset(123_500)).toBe("+2m 03.5s");
  expect(formatDuration(0.2)).toBe("<1 ms");
  expect(formatDuration(812)).toBe("812 ms");
  expect(formatDuration(2_345)).toBe("2.35 s");
});

it("counts events by level", () => {
  expect(countByLevel(events)).toEqual({ trace: 0, debug: 2, info: 1, warn: 1, error: 0 });
});
