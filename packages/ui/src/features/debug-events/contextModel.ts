import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import { parseRefs, type TraceNode } from "./debugTrace";

/**
 * What the model saw, turn by turn. kushibot's `context.window` event measures every message the
 * next model call carries (bytes, grouped by origin). Runs recorded before that event existed only
 * have the provider's input-token counts, so their composition is estimated from how much the
 * input grew after each action.
 */
export type ContextUnit = "bytes" | "tokens";

/** Where context comes from; each origin has its own color. */
export type OriginKind = "instructions" | "task" | "assistant" | "observation" | "base";

export type Segment = Readonly<{
  /** "instructions", "task", "assistant", "obs.tool.read_file", "base"… */
  key: string;
  label: string;
  kind: OriginKind;
  value: number;
  /** Appended since the previous model call. */
  added: boolean;
}>;

export type ContextMessage = Readonly<{
  index: number;
  kind: "task" | "assistant" | "observation";
  source: string;
  bytes: number;
  added: boolean;
}>;

export type Usage = Readonly<{ input: number; cached: number; output: number; reasoning: number }>;

export type ArtifactItem = Readonly<{
  spanId: string;
  id: string;
  kind: string;
  name: string;
  media: string | null;
  digest: string | null;
  sources: readonly string[];
  bytes: number;
  atMs: number;
  sessionId: string | null;
  turn: number | null;
}>;

export type ContextTurn = Readonly<{
  spanId: string;
  number: number;
  startMs: number;
  durationMs: number | null;
  unit: ContextUnit;
  /** The context the turn's model call carried, by origin, oldest first; added pieces last. */
  segments: readonly Segment[];
  total: number;
  /** kushibot's request size bound, the window it must fit in, and the share used. */
  tokenUpperBound: number | null;
  budget: number | null;
  fill: number | null;
  messages: number | null;
  /** Individual messages, when recorded (the most recent 24). */
  messageList: readonly ContextMessage[];
  addedValue: number;
  addedLabel: string | null;
  usage: Usage | null;
  action: "tool" | "note" | "final" | "invalid" | null;
  tool: string | null;
  toolStatus: string | null;
  acceptance: string | null;
  notebook: Readonly<{ entries: number; bytes: number; full: boolean }> | null;
  artifacts: readonly ArtifactItem[];
  overLimit: boolean;
}>;

export type ContextSession = Readonly<{
  spanId: string;
  sessionId: string;
  step: string | null;
  mode: string | null;
  executor: string | null;
  /** What the session started from: its instructions and the task input handed to it. */
  instructionsBytes: number | null;
  inputBytes: number | null;
  turns: readonly ContextTurn[];
  outcome: string | null;
  resultBytes: number | null;
  notebookEntries: number;
  notebookBytes: number;
  peakFill: number | null;
  /** The largest context any turn carried, in the session's unit. */
  peak: number;
  unit: ContextUnit;
}>;

export type CompressionItem = Readonly<{
  spanId: string;
  atMs: number;
  state: string;
  code: string | null;
  metrics: Readonly<Record<string, number>>;
  replaced: readonly string[];
}>;

export type CompositionItem = Readonly<{
  spanId: string;
  atMs: number;
  state: string;
  code: string | null;
  metrics: Readonly<Record<string, number>>;
  included: readonly string[];
  dropped: readonly string[];
  omitted: readonly string[];
}>;

export type RecallItem = Readonly<{
  spanId: string;
  atMs: number;
  state: string;
  topic: string | null;
  recalled: readonly string[];
  skipped: readonly string[];
}>;

export type ContextModel = Readonly<{
  sessions: readonly ContextSession[];
  artifacts: readonly ArtifactItem[];
  collected: Readonly<{ count: number; bytes: number }> | null;
  compressions: readonly CompressionItem[];
  compositions: readonly CompositionItem[];
  recalls: readonly RecallItem[];
  /** Whether kushibot measured the context itself (`context.window`), rather than estimated. */
  measured: boolean;
  limitHits: number;
}>;

const ORIGIN_LABELS: Readonly<Record<string, string | undefined>> & { base: string } = {
  instructions: "Instructions",
  task: "Task input",
  assistant: "Model actions",
  base: "Instructions + task",
};

/** "obs.tool.read_file" → "read_file result"; "obs.notebook" → "note acknowledgement". */
export function originLabel(key: string): string {
  const known = ORIGIN_LABELS[key];
  if (known) return known;
  const source = key.startsWith("obs.") ? key.slice(4) : key;
  if (source.startsWith("tool.")) return `${source.slice(5)} result`;
  if (source === "notebook") return "note acknowledgement";
  if (source === "correction") return "correction feedback";
  if (source === "rejected") return "rejected tool call";
  return source;
}

function payloadOf(span: TraceNode, operation: string): DebugEventDto["payload"] | undefined {
  return span.events.findLast((item) => item.event.payload.operation === operation)?.event.payload;
}

function refOf(payload: DebugEventDto["payload"] | undefined, key: string): string | null {
  return parseRefs(payload?.relatedRefs).get(key)?.[0] ?? null;
}

function* descendants(span: TraceNode): Generator<TraceNode> {
  for (const child of span.children) {
    yield child;
    yield* descendants(child);
  }
}

function artifactOf(span: TraceNode, sessionId: string | null, turn: number | null): ArtifactItem {
  const stored = payloadOf(span, "artifact.stored");
  const refs = parseRefs(stored?.relatedRefs ?? span.start?.event.payload.relatedRefs);
  return {
    spanId: span.id,
    id: refs.get("artifact")?.[0] ?? "(not stored)",
    kind: refs.get("kind")?.[0] ?? "artifact",
    name: refs.get("name")?.[0] ?? "",
    media: refs.get("media")?.[0] ?? null,
    digest: refs.get("digest")?.[0] ?? null,
    sources: refs.get("source") ?? [],
    bytes: stored?.metrics?.bytes ?? span.start?.event.payload.metrics?.bytes ?? 0,
    atMs: span.startMs,
    sessionId,
    turn,
  };
}

function usageOf(turn: TraceNode): Usage | null {
  for (const child of turn.children) {
    if (child.kind !== "model") continue;
    const reply = payloadOf(child, "model.reply");
    const refs = parseRefs(reply?.relatedRefs);
    const input = refs.get("inputTokens")?.[0];
    if (input === undefined) continue;
    return {
      input: Number(input),
      cached: Number(refs.get("cachedInputTokens")?.[0] ?? 0),
      output: Number(refs.get("outputTokens")?.[0] ?? 0),
      reasoning: Number(refs.get("reasoningTokens")?.[0] ?? 0),
    };
  }
  return null;
}

/** Messages the window event listed: "msg:<index>:<kind>:<source>:<bytes>". */
function messagesOf(window: DebugEventDto["payload"], previousCount: number): ContextMessage[] {
  return (parseRefs(window.relatedRefs).get("msg") ?? []).flatMap((value) => {
    const [index, kind, source, bytes] = value.split(":");
    if (kind !== "task" && kind !== "assistant" && kind !== "observation") return [];
    return [
      {
        index: Number(index),
        kind,
        source: source ?? "",
        bytes: Number(bytes ?? 0),
        added: Number(index) > previousCount,
      },
    ];
  });
}

function keyOf(message: ContextMessage): string {
  return message.kind === "observation" ? `obs.${message.source}` : message.kind;
}

/** Measured composition: kushibot's per-origin sizes, with what this turn appended split off. */
function measuredSegments(
  metrics: Readonly<Record<string, number>>,
  messages: readonly ContextMessage[],
): Segment[] {
  const totals = new Map<string, number>([
    ["instructions", metrics.instructionsBytes ?? 0],
    ["task", metrics.taskBytes ?? 0],
    ["assistant", metrics.assistantBytes ?? 0],
  ]);
  for (const [key, value] of Object.entries(metrics))
    if (key.startsWith("obs.")) totals.set(key, value);
  // An observation origin cut from the metric budget still counts, under "other".
  const listed = [...totals]
    .filter(([key]) => key.startsWith("obs."))
    .reduce((a, [, v]) => a + v, 0);
  const missing = (metrics.observationBytes ?? 0) - listed;
  if (missing > 0) totals.set("obs.other", (totals.get("obs.other") ?? 0) + missing);
  const added: Segment[] = [];
  for (const message of messages) {
    if (!message.added) continue;
    const key = keyOf(message);
    totals.set(key, Math.max(0, (totals.get(key) ?? 0) - message.bytes));
    added.push({
      key,
      label: message.kind === "assistant" ? `model action (${message.source})` : originLabel(key),
      kind: message.kind,
      value: message.bytes,
      added: true,
    });
  }
  const base: Segment[] = [...totals]
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      key,
      label: originLabel(key),
      kind:
        key === "instructions" || key === "task" || key === "assistant"
          ? (key as OriginKind)
          : "observation",
      value,
      added: false,
    }));
  return [...base, ...added];
}

type Draft = {
  span: TraceNode;
  number: number;
  window: DebugEventDto["payload"] | undefined;
  usage: Usage | null;
  action: ContextTurn["action"];
  tool: string | null;
  label: string | null;
};

/** One session's turns; the composition comes from `context.window` or from token growth. */
function turnsOf(mind: TraceNode, sessionId: string): ContextTurn[] {
  const drafts: Draft[] = mind.children
    .filter((child) => child.kind === "turn")
    .map((span, index) => {
      const action = payloadOf(span, "session.action");
      const state = action?.nextState;
      const tool = refOf(action, "tool");
      return {
        span,
        number: span.start?.event.payload.count ?? index + 1,
        window: payloadOf(span, "context.window"),
        usage: usageOf(span),
        action:
          state === "tool" || state === "note" || state === "final" || state === "invalid"
            ? state
            : null,
        tool,
        label:
          state === "tool"
            ? `${tool ?? "tool"} result`
            : state === "note"
              ? "note"
              : state === "final"
                ? "final result"
                : state === "invalid"
                  ? "invalid action"
                  : null,
      };
    });

  // Estimated composition: the first call's input is the base, each later growth belongs to
  // what the previous turn did (its action and the observation it produced).
  const estimated = new Map<string, number>();
  const order: string[] = [];
  let previousInput: number | null = null;
  let previousCount = 0;

  return drafts.map((draft, index) => {
    const { span, window, usage } = draft;
    const metrics = window?.metrics;
    const previous = drafts[index - 1];
    let segments: Segment[];
    let unit: ContextUnit;
    let messageList: ContextMessage[] = [];
    let addedValue = 0;
    let addedLabel: string | null = null;
    if (window && metrics) {
      unit = "bytes";
      messageList = messagesOf(window, previousCount);
      segments = measuredSegments(metrics, messageList);
      addedValue = segments.filter((s) => s.added).reduce((a, s) => a + s.value, 0);
      addedLabel = refOf(window, "added");
      addedLabel = addedLabel ? originLabel(`obs.${addedLabel}`) : null;
      previousCount = metrics.messages ?? window.count ?? previousCount;
    } else {
      unit = "tokens";
      segments = [];
      if (usage) {
        if (previousInput === null) {
          estimated.set("base", usage.input);
          order.push("base");
          segments = [
            {
              key: "base",
              label: ORIGIN_LABELS.base,
              kind: "base",
              value: usage.input,
              added: false,
            },
          ];
        } else {
          const growth = Math.max(0, usage.input - previousInput);
          const key = previous?.tool
            ? `obs.tool.${previous.tool}`
            : `obs.${previous?.label ?? "other"}`;
          segments = order
            .map((existing) => ({
              key: existing,
              label: originLabel(existing),
              kind: (existing === "base" ? "base" : "observation") as OriginKind,
              value: estimated.get(existing) ?? 0,
              added: false,
            }))
            .filter((segment) => segment.value > 0);
          segments.push({
            key,
            label: previous?.label ? `${previous.label} (+ model action)` : "growth",
            kind: "observation",
            value: growth,
            added: true,
          });
          addedValue = growth;
          addedLabel = previous?.label ?? null;
          if (!estimated.has(key)) order.push(key);
          estimated.set(key, (estimated.get(key) ?? 0) + growth);
        }
        previousInput = usage.input;
      }
    }
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    const tokenUpperBound = metrics?.tokenUpperBound ?? null;
    const budget =
      metrics?.contextTokens !== undefined
        ? metrics.contextTokens - (metrics.maxOutputTokens ?? 0)
        : null;
    const notebook = payloadOf(span, "notebook.updated");
    const toolSpan = span.children.find((child) => child.kind === "tool");
    return {
      spanId: span.id,
      number: draft.number,
      startMs: span.startMs,
      durationMs: span.durationMs,
      unit,
      segments,
      total,
      tokenUpperBound,
      budget,
      fill: tokenUpperBound !== null && budget ? tokenUpperBound / budget : null,
      messages:
        metrics?.messages ??
        span.children.find((child) => child.kind === "model")?.start?.event.payload.count ??
        null,
      messageList,
      addedValue,
      addedLabel,
      usage,
      action: draft.action,
      tool: draft.tool,
      toolStatus: toolSpan ? (payloadOf(toolSpan, "tool.outcome")?.nextState ?? null) : null,
      acceptance: payloadOf(span, "session.acceptance")?.nextState ?? null,
      notebook: notebook
        ? {
            entries: notebook.metrics?.entries ?? notebook.count ?? 0,
            bytes: notebook.metrics?.bytes ?? 0,
            full: notebook.nextState === "full",
          }
        : null,
      artifacts: [...descendants(span)]
        .filter((child) => child.kind === "artifact")
        .map((child) => artifactOf(child, sessionId, draft.number)),
      overLimit:
        window?.nextState === "over-limit" ||
        span.events.some((item) => item.event.payload.operation === "context.limit"),
    };
  });
}

/** Rebuilds the run's context story from its trace tree and events. */
export function buildContextModel(
  root: TraceNode,
  events: readonly RecordedDebugEventDto[],
): ContextModel {
  const sessions: ContextSession[] = [];
  const starts = new Map<string, DebugEventDto["payload"]>();
  const compressions: CompressionItem[] = [];
  const compositions: CompositionItem[] = [];
  const recalls: RecallItem[] = [];

  const walk = (span: TraceNode, step: string | null, executor: string | null): void => {
    const nextStep = span.kind === "step" ? (span.refs.get("step")?.[0] ?? step) : step;
    const nextExecutor =
      span.kind === "executor" ? (span.refs.get("executor")?.[0] ?? executor) : executor;
    for (const item of span.events) {
      const payload = item.event.payload;
      if (payload.operation !== "agent.session") continue;
      const session = refOf(payload, "session");
      if (session) starts.set(session, payload);
    }
    if (span.kind === "mind") {
      const sessionId = span.refs.get("session")?.[0] ?? span.identity.sessionId ?? span.id;
      const start = starts.get(sessionId);
      const turns = turnsOf(span, sessionId);
      const accepted = turns.findLast((turn) => turn.acceptance === "accepted");
      const finalTurn = turns.findLast((turn) => turn.acceptance !== null);
      const resultBytes =
        accepted &&
        span.children
          .find((child) => child.id === accepted.spanId)
          ?.events.findLast((item) => item.event.payload.operation === "session.acceptance")?.event
          .payload.metrics?.resultBytes;
      const lastNotebook = turns.findLast((turn) => turn.notebook !== null)?.notebook;
      const fills = turns.map((turn) => turn.fill).filter((fill): fill is number => fill !== null);
      sessions.push({
        spanId: span.id,
        sessionId,
        step: nextStep,
        mode: refOf(start, "mode"),
        executor: nextExecutor,
        instructionsBytes: start?.metrics?.instructionsBytes ?? null,
        inputBytes: start?.metrics?.inputBytes ?? null,
        turns,
        outcome: payloadOf(span, "mind-unit.outcome")?.nextState ?? finalTurn?.acceptance ?? null,
        resultBytes: resultBytes ?? null,
        notebookEntries: lastNotebook?.entries ?? 0,
        notebookBytes: lastNotebook?.bytes ?? 0,
        peakFill: fills.length ? Math.max(...fills) : null,
        peak: Math.max(0, ...turns.map((turn) => turn.total)),
        unit: turns.some((turn) => turn.unit === "bytes") ? "bytes" : "tokens",
      });
    }
    if (span.kind === "context") {
      const outcome = payloadOf(span, "context.compressed") ?? payloadOf(span, "context.composed");
      const refs = parseRefs(outcome?.relatedRefs);
      const base = {
        spanId: span.id,
        atMs: span.startMs,
        state: outcome?.nextState ?? (span.end ? "unknown" : "running"),
        code: outcome?.code ?? null,
        metrics: outcome?.metrics ?? {},
      };
      if (span.operation === "context.compress")
        compressions.push({ ...base, replaced: refs.get("replaced") ?? [] });
      else
        compositions.push({
          ...base,
          included: refs.get("include") ?? [],
          dropped: refs.get("dropped") ?? [],
          omitted: refs.get("omitted") ?? [],
        });
    }
    if (span.kind === "memory") {
      const outcome = payloadOf(span, "memory.recalled");
      const refs = parseRefs(outcome?.relatedRefs ?? span.start?.event.payload.relatedRefs);
      recalls.push({
        spanId: span.id,
        atMs: span.startMs,
        state: outcome?.nextState ?? "running",
        topic: refs.get("topic")?.[0] ?? null,
        recalled: refs.get("recalled") ?? [],
        skipped: refs.get("skipped") ?? [],
      });
    }
    for (const child of span.children) walk(child, nextStep, nextExecutor);
  };
  walk(root, null, null);

  const artifacts: ArtifactItem[] = [];
  const collect = (span: TraceNode): void => {
    if (span.kind === "artifact") {
      const turn = sessions
        .flatMap((session) => session.turns.map((t) => ({ session, t })))
        .find(({ t }) => t.artifacts.some((artifact) => artifact.spanId === span.id));
      artifacts.push(
        turn
          ? turn.t.artifacts.find((artifact) => artifact.spanId === span.id)!
          : artifactOf(span, null, null),
      );
    }
    span.children.forEach(collect);
  };
  collect(root);

  const collectedEvent = events.findLast(
    (item) => item.event.payload.operation === "artifacts.collected",
  )?.event.payload;

  return {
    sessions,
    artifacts,
    collected: collectedEvent
      ? { count: collectedEvent.count ?? 0, bytes: collectedEvent.metrics?.bytes ?? 0 }
      : null,
    compressions,
    compositions,
    recalls,
    measured: events.some((item) => item.event.payload.operation === "context.window"),
    limitHits: events.filter((item) => item.event.payload.operation === "context.limit").length,
  };
}
