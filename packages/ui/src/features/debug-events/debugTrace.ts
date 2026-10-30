import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";

/** What a span is in kushibot's harness, from outermost to innermost. */
export type SpanKind =
  | "root"
  | "run"
  | "step"
  | "executor"
  | "mind"
  | "turn"
  | "model"
  | "tool"
  | "context"
  | "memory"
  | "artifact"
  | "other";

export type Tone = "default" | "primary" | "success" | "warning" | "error";

export type Badge = Readonly<{ text: string; tone: Tone; hint?: string }>;

export type TraceNode = {
  /** The span id; "root" for the run's own span. */
  id: string;
  kind: SpanKind;
  operation: string;
  title: string;
  subtitle: string | null;
  status: "running" | "ok" | "warn" | "failed";
  /** Epoch ms. */
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  start: RecordedDebugEventDto | null;
  end: RecordedDebugEventDto | null;
  /** Point events recorded inside this span (not its children's), oldest first. */
  events: RecordedDebugEventDto[];
  children: TraceNode[];
  /** `relatedRefs` of the start event and the point events, split at the first ":". */
  refs: Map<string, string[]>;
  badges: Badge[];
  identity: DebugEventDto["identity"];
  depth: number;
};

export type TraceStats = Readonly<{
  durationMs: number;
  steps: number;
  turns: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  warnings: number;
  errors: number;
  models: readonly string[];
}>;

const KINDS: Readonly<Record<string, SpanKind>> = {
  "agent.run": "run",
  "workflow.step": "step",
  "workflow.step.resume": "step",
  "executor.run": "executor",
  "mind-unit.run": "mind",
  "session.turn": "turn",
  "model.call": "model",
  "tool.call": "tool",
  "context.compose": "context",
  "context.compress": "context",
  "memory.recall": "memory",
  "artifact.write": "artifact",
};

/**
 * Outcome events reported right after their operation ended, so they land in the parent span.
 * Each is shown on the most recent span of the named operation.
 */
const OUTCOME_OF: Readonly<Record<string, string>> = {
  "agent.outcome": "agent.run",
  "workflow.step.outcome": "workflow.step",
  "workflow.step.resume.outcome": "workflow.step.resume",
  "executor.outcome": "executor.run",
  "mind-unit.outcome": "mind-unit.run",
  "model.reply": "model.call",
  "tool.outcome": "tool.call",
  "context.composed": "context.compose",
  "context.compressed": "context.compress",
  "memory.recalled": "memory.recall",
  "artifact.stored": "artifact.write",
};

/** Plain-language explanations for the inspector. */
export const KIND_INFO: Readonly<Record<SpanKind, Readonly<{ label: string; about: string }>>> = {
  root: {
    label: "Run",
    about:
      "Everything kushibot recorded for this chat run. Events outside any operation (progress messages, the final agent outcome) live here.",
  },
  run: {
    label: "Agent run",
    about:
      "The agent invocation. kushibot builds the workflow for the task and the workflow engine runs its steps until the completion policy accepts the result or a limit stops it.",
  },
  step: {
    label: "Workflow step",
    about:
      "One step of the workflow. The step runner claims an attempt, prepares the executor input with the step's input policy, dispatches the executor and asks the acceptance policy to judge the result.",
  },
  executor: {
    label: "Executor",
    about:
      "The registered executor the step dispatched. It receives the prepared input and returns a completed, stopped or failed outcome that the step then judges.",
  },
  mind: {
    label: "Agentic mind unit",
    about:
      "An agentic session owned by an agent-task executor. It loops through turns: the model chooses an action (write a note, call a tool, or return a final result) until a result is accepted or a limit is reached.",
  },
  turn: {
    label: "Session turn",
    about:
      "One turn of the mind unit: a model call, then the action the model chose — a notebook entry, a tool call, or a final result checked by the result contract and the acceptance policy.",
  },
  model: {
    label: "Model call",
    about:
      "One request to the model gateway, with the model used, the reply status and token usage.",
  },
  tool: {
    label: "Tool call",
    about:
      "One tool dispatch requested by the model, with how it ended. Tool arguments are not recorded.",
  },
  context: {
    label: "Context",
    about:
      "kushibot building or shrinking the model's context: composition picks which fragments fit the window; compression replaces several observations with a verified summary stored as an artifact.",
  },
  memory: {
    label: "Memory recall",
    about:
      "Long-term memory retrieval: accepted memories on a topic are re-verified against their sources; stale ones are skipped, the rest become context fragments.",
  },
  artifact: {
    label: "Artifact write",
    about:
      "A durable artifact stored by the run (for example a workspace change). The payload lives in the artifact store; the trace keeps its id, kind, size and digest.",
  },
  other: { label: "Operation", about: "An operation kushibot traced." },
};

/** "key:value" refs as a map; refs without a colon are filed under "". */
export function parseRefs(refs: readonly string[] | undefined, into = new Map<string, string[]>()) {
  for (const ref of refs ?? []) {
    const at = ref.indexOf(":");
    const key = at < 0 ? "" : ref.slice(0, at);
    const value = at < 0 ? ref : ref.slice(at + 1);
    const values = into.get(key);
    if (values) {
      if (!values.includes(value)) values.push(value);
    } else into.set(key, [value]);
  }
  return into;
}

function ref(event: DebugEventDto, key: string): string | undefined {
  return parseRefs(event.payload.relatedRefs).get(key)?.[0];
}

function node(
  id: string,
  operation: string,
  at: number,
  identity: DebugEventDto["identity"],
): TraceNode {
  return {
    id,
    kind: KINDS[operation] ?? (id === "root" ? "root" : "other"),
    operation,
    title: operation,
    subtitle: null,
    status: "running",
    startMs: at,
    endMs: null,
    durationMs: null,
    start: null,
    end: null,
    events: [],
    children: [],
    refs: new Map(),
    badges: [],
    identity,
    depth: 0,
  };
}

/** Rebuilds kushibot's span tree from the run's events: operations nest by parent span. */
export function buildTrace(events: readonly RecordedDebugEventDto[]): TraceNode {
  const first = events[0]?.event;
  const root = node(
    "root",
    "run",
    first?.occurredAtEpochMs ?? 0,
    first?.identity ?? { operationId: "" },
  );
  root.kind = "root";
  root.title = "Run";
  const spans = new Map<string, TraceNode>();
  const parents = new Map<string, string | null>();

  for (const item of events) {
    const { event } = item;
    const { trace, payload } = event;
    if (event.type === "operation.started") {
      const span = node(
        trace.spanId,
        payload.operation ?? event.type,
        event.occurredAtEpochMs,
        event.identity,
      );
      span.start = item;
      parseRefs(payload.relatedRefs, span.refs);
      spans.set(trace.spanId, span);
      parents.set(trace.spanId, trace.parentSpanId);
    } else if (event.type === "operation.completed" || event.type === "operation.failed") {
      let span = spans.get(trace.spanId);
      if (!span) {
        // The start was not recorded (filtered or dropped): place the span by its end.
        span = node(
          trace.spanId,
          payload.operation ?? event.type,
          event.occurredAtEpochMs - (payload.durationMs ?? 0),
          event.identity,
        );
        spans.set(trace.spanId, span);
        parents.set(trace.spanId, trace.parentSpanId);
      }
      span.end = item;
      span.durationMs = payload.durationMs ?? event.occurredAtEpochMs - span.startMs;
      span.endMs = span.startMs + span.durationMs;
    }
  }

  // Link spans in start order, so children read top to bottom as they happened.
  for (const span of spans.values()) {
    const parent = spans.get(parents.get(span.id) ?? "") ?? root;
    parent.children.push(span);
  }

  for (const item of events) {
    const { event } = item;
    if (event.type.startsWith("operation.")) continue;
    let home = spans.get(event.trace.spanId) ?? root;
    const owner = OUTCOME_OF[event.payload.operation ?? ""];
    if (owner && home.operation !== owner) {
      const recent = [...home.children]
        .reverse()
        .find((child) => child.operation === owner && child.startMs <= event.occurredAtEpochMs);
      if (recent) home = recent;
    }
    home.events.push(item);
    parseRefs(event.payload.relatedRefs, home.refs);
  }

  const last = events.at(-1)?.event.occurredAtEpochMs ?? root.startMs;
  root.endMs = last;
  root.durationMs = last - root.startMs;
  root.status = "ok";
  finalize(root, 0);
  return root;
}

function finalize(span: TraceNode, depth: number): void {
  span.depth = depth;
  span.children.sort(
    (a, b) => a.startMs - b.startMs || (a.start?.sequence ?? 0) - (b.start?.sequence ?? 0),
  );
  for (const child of span.children) finalize(child, depth + 1);
  describeSpan(span);
}

function outcomeOf(span: TraceNode, operation: string): DebugEventDto | undefined {
  return span.events.findLast((item) => item.event.payload.operation === operation)?.event;
}

function toneOf(state: string | undefined): Tone {
  if (!state) return "default";
  if (["completed", "accepted", "recorded", "taken", "final"].includes(state)) return "success";
  if (["failed", "invalid", "refused", "unavailable"].includes(state)) return "error";
  if (
    [
      "stopped",
      "rejected",
      "schema-rejected",
      "blocked",
      "pending",
      "incomplete",
      "not-evaluated",
    ].includes(state)
  )
    return "warning";
  return "default";
}

const short = (id: string | undefined) => (id ? id.slice(0, 8) : "");

function describeSpan(span: TraceNode): void {
  const badges: Badge[] = [];
  const first = (key: string) => span.refs.get(key)?.[0];
  switch (span.kind) {
    case "root": {
      const outcome = outcomeOf(span, "agent.outcome");
      if (outcome?.payload.nextState)
        badges.push({ text: outcome.payload.nextState, tone: toneOf(outcome.payload.nextState) });
      break;
    }
    case "run": {
      span.title = `Agent ${first("agent") ?? ""}`.trim();
      const workflow = first("workflow");
      span.subtitle = workflow ? `workflow ${workflow}` : null;
      const outcome = outcomeOf(span, "agent.outcome");
      if (outcome?.payload.nextState)
        badges.push({ text: outcome.payload.nextState, tone: toneOf(outcome.payload.nextState) });
      break;
    }
    case "step": {
      const step = first("step") ?? "?";
      span.title =
        span.operation === "workflow.step.resume" ? `Step “${step}” (resumed)` : `Step “${step}”`;
      const attempt = first("attempt");
      const executor = first("executor");
      span.subtitle =
        [attempt && `attempt ${attempt}`, executor && `→ ${executor}`]
          .filter(Boolean)
          .join(" · ") || null;
      const acceptance = outcomeOf(span, "step.acceptance");
      if (acceptance?.payload.nextState)
        badges.push({
          text: acceptance.payload.nextState,
          tone: toneOf(acceptance.payload.nextState),
          hint: acceptance.payload.summary ?? "The acceptance policy's verdict on the step result.",
        });
      const outcome =
        outcomeOf(span, "workflow.step.outcome") ?? outcomeOf(span, "workflow.step.resume.outcome");
      if (outcome?.payload.nextState && outcome.payload.nextState !== "recorded")
        badges.push({
          text: outcome.payload.nextState,
          tone: toneOf(outcome.payload.nextState),
          hint: outcome.payload.code,
        });
      break;
    }
    case "executor": {
      span.title = `Executor ${first("executor") ?? ""}`.trim();
      const input = first("input");
      const result = first("result");
      span.subtitle = input || result ? `${input ?? "?"} → ${result ?? "?"}` : null;
      const outcome = outcomeOf(span, "executor.outcome");
      if (outcome?.payload.nextState)
        badges.push({
          text: outcome.payload.nextState,
          tone: toneOf(outcome.payload.nextState),
          hint: outcome.payload.code,
        });
      break;
    }
    case "mind": {
      span.title = "Agentic mind unit";
      const turns = span.children.filter((child) => child.kind === "turn").length;
      const session = first("session") ?? span.identity.sessionId;
      span.subtitle = [
        session && `session ${short(session)}`,
        `${turns} ${turns === 1 ? "turn" : "turns"}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const outcome = outcomeOf(span, "mind-unit.outcome");
      if (outcome?.payload.nextState)
        badges.push({
          text: outcome.payload.nextState,
          tone: toneOf(outcome.payload.nextState),
          hint: outcome.payload.summary,
        });
      break;
    }
    case "turn": {
      span.title = `Turn ${first("turn") ?? span.start?.event.payload.count ?? ""}`.trim();
      const action = outcomeOf(span, "session.action");
      const state = action?.payload.nextState;
      const tool = action && ref(action, "tool");
      span.subtitle =
        state === "tool"
          ? `calls tool ${tool ?? ""}`
          : state === "note"
            ? "writes a note"
            : state === "final"
              ? "returns a final result"
              : state === "invalid"
                ? "invalid action"
                : null;
      if (state === "invalid") badges.push({ text: "invalid action", tone: "error" });
      const acceptance = outcomeOf(span, "session.acceptance");
      if (acceptance?.payload.nextState)
        badges.push({
          text: acceptance.payload.nextState,
          tone: toneOf(acceptance.payload.nextState),
          hint: acceptance.payload.summary,
        });
      break;
    }
    case "model": {
      const reply = outcomeOf(span, "model.reply");
      span.title = "Model call";
      span.subtitle = (reply && ref(reply, "model")) ?? null;
      if (reply) {
        const input = ref(reply, "inputTokens");
        const output = ref(reply, "outputTokens");
        if (input || output)
          badges.push({
            text: `${formatCount(Number(input ?? 0))} in · ${formatCount(Number(output ?? 0))} out`,
            tone: "default",
            hint: "Tokens",
          });
        if (reply.payload.nextState && reply.payload.nextState !== "completed")
          badges.push({ text: reply.payload.nextState, tone: toneOf(reply.payload.nextState) });
      }
      break;
    }
    case "tool": {
      span.title = `Tool ${first("tool") ?? ""}`.trim();
      const outcome = outcomeOf(span, "tool.outcome");
      if (outcome?.payload.nextState)
        badges.push({
          text: outcome.payload.nextState,
          tone: toneOf(outcome.payload.nextState),
          hint: outcome.payload.code,
        });
      if (outcome && parseRefs(outcome.payload.relatedRefs).get("")?.includes("replayed"))
        badges.push({ text: "replayed", tone: "default" });
      break;
    }
    case "context": {
      const outcome = outcomeOf(span, "context.composed") ?? outcomeOf(span, "context.compressed");
      const metrics = outcome?.payload.metrics;
      if (span.operation === "context.compress") {
        span.title = "Context compression";
        span.subtitle =
          metrics?.beforeTokens !== undefined && metrics.afterTokens !== undefined
            ? `${formatCount(metrics.beforeTokens)} → ${formatCount(metrics.afterTokens)} tokens`
            : null;
      } else {
        span.title = "Context composition";
        span.subtitle = metrics
          ? `${metrics.included ?? 0} fragments in · ${metrics.droppedForSize ?? 0} dropped for size`
          : null;
      }
      if (outcome?.payload.nextState)
        badges.push({
          text: outcome.payload.nextState,
          tone:
            outcome.payload.nextState === "prepared" || outcome.payload.nextState === "ready"
              ? "success"
              : "warning",
          hint: outcome.payload.code,
        });
      break;
    }
    case "memory": {
      const outcome = outcomeOf(span, "memory.recalled");
      span.title = `Memory recall${first("topic") ? ` “${first("topic")}”` : ""}`;
      const metrics = outcome?.payload.metrics;
      span.subtitle = metrics
        ? `${metrics.recalled ?? 0} recalled · ${metrics.skipped ?? 0} stale`
        : null;
      if (outcome?.payload.nextState)
        badges.push({ text: outcome.payload.nextState, tone: toneOf(outcome.payload.nextState) });
      break;
    }
    case "artifact": {
      const outcome = outcomeOf(span, "artifact.stored");
      span.title = `Artifact ${first("kind") ?? ""}`.trim();
      const id = outcome && ref(outcome, "artifact");
      const bytes = outcome?.payload.metrics?.bytes;
      span.subtitle =
        [id && `#${short(id)}`, bytes !== undefined && formatBytes(bytes)]
          .filter(Boolean)
          .join(" · ") || null;
      if (outcome) badges.push({ text: "stored", tone: "success" });
      break;
    }
    case "other":
      span.title = span.operation;
  }
  span.badges = badges;
  span.status =
    span.end?.event.type === "operation.failed" || badges.some((badge) => badge.tone === "error")
      ? "failed"
      : span.end === null && span.kind !== "root"
        ? "running"
        : badges.some((badge) => badge.tone === "warning")
          ? "warn"
          : "ok";
}

export type EventLine = Readonly<{ text: string; tone: Tone; detail: string | null }>;

/** One point event as a sentence, for the inspector and the event list. */
export function describeEvent(event: DebugEventDto): EventLine {
  const { payload } = event;
  const state = payload.nextState;
  const refs = parseRefs(payload.relatedRefs);
  const get = (key: string) => refs.get(key)?.[0];
  const detail = payload.summary ?? null;
  const tone: Tone =
    event.level === "error" ? "error" : event.level === "warn" ? "warning" : toneOf(state);
  switch (payload.operation) {
    case "workflow.plan":
      return {
        text: `Workflow planned with ${payload.count ?? refs.get("step")?.length ?? 0} steps`,
        tone: "primary",
        detail: [
          ...(refs.get("step") ?? []).map(
            (value) => `step ${value.replace("=executor:", " → executor ")}`,
          ),
          ...(refs.get("transition") ?? []).map((value) => `transition ${value}`),
        ].join("\n"),
      };
    case "step.attempt":
      return {
        text: `Attempt ${get("attempt") ?? payload.count ?? ""} dispatched to executor ${get("executor") ?? "?"}`,
        tone: "primary",
        detail:
          [
            get("input-policy") && `input policy ${get("input-policy")}`,
            get("acceptance-policy") && `acceptance policy ${get("acceptance-policy")}`,
          ]
            .filter(Boolean)
            .join("\n") || null,
      };
    case "step.acceptance":
      return {
        text: `Acceptance policy: ${state ?? "?"}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail,
      };
    case "executor.outcome":
      return {
        text: `Executor ${get("executor") ?? ""} returned ${state ?? "?"}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail,
      };
    case "workflow.step.outcome":
    case "workflow.step.resume.outcome":
      return {
        text: `Step ${get("step") ?? ""} ${state ?? "?"}${get("acceptance") ? `, result ${get("acceptance")}` : ""}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail,
      };
    case "workflow.transition":
      return {
        text: `Transition ${get("transition") ?? ""} (${get("from") ?? "?"} → ${get("to") ?? "?"}): ${state === "taken" ? "taken" : "not taken"}`,
        tone: state === "taken" ? "primary" : "default",
        detail: get("policy") ? `policy ${get("policy")}` : null,
      };
    case "workflow.correction":
      return {
        text: `Correction applied: step ${get("step") ?? "?"} re-runs via transition ${get("transition") ?? "?"}`,
        tone: "warning",
        detail,
      };
    case "workflow.completion":
      return {
        text: `Completion policy ${state === "accepted" ? "accepted the workflow result" : "rejected the workflow result"}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail:
          [get("steps") && `${get("steps")} steps accepted`, detail].filter(Boolean).join("\n") ||
          null,
      };
    case "workflow.stopped":
      return {
        text: `Workflow stopped${payload.code ? `: ${payload.code}` : ""}`,
        tone: "warning",
        detail,
      };
    case "workflow.failed":
      return { text: "Workflow failed", tone: "error", detail };
    case "agent.session":
      return {
        text: `Agent session opened${get("mode") ? ` in ${get("mode")} mode` : ""}${get("max-turns") ? `, up to ${get("max-turns")} turns` : ""}`,
        tone: "primary",
        detail: get("session") ? `session ${get("session")}` : null,
      };
    case "session.action":
      return {
        text:
          state === "tool"
            ? `Model chose to call tool ${get("tool") ?? "?"}`
            : state === "note"
              ? "Model wrote a notebook entry"
              : state === "final"
                ? "Model returned a final result"
                : "Model reply was not a valid action",
        tone: state === "invalid" ? "error" : "primary",
        detail,
      };
    case "session.acceptance":
      return {
        text:
          state === "accepted"
            ? "Final result accepted"
            : state === "schema-rejected"
              ? "Final result failed the result contract"
              : "Final result rejected by the acceptance policy",
        tone,
        detail,
      };
    case "mind-unit.outcome":
      return {
        text: `Mind unit ${state ?? "finished"}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail,
      };
    case "model.reply": {
      const tokens = [
        get("inputTokens") && `${formatCount(Number(get("inputTokens")))} input`,
        get("outputTokens") && `${formatCount(Number(get("outputTokens")))} output`,
        get("cachedInputTokens") && `${formatCount(Number(get("cachedInputTokens")))} cached`,
        get("reasoningTokens") && `${formatCount(Number(get("reasoningTokens")))} reasoning`,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        text: `Model ${get("model") ?? ""} replied: ${state ?? "?"}${tokens ? ` — ${tokens} tokens` : ""}`,
        tone,
        detail: get("error") ? `error ${get("error")}` : null,
      };
    }
    case "tool.outcome":
      return {
        text: `Tool ${get("tool") ?? ""} ${state ?? "finished"}${payload.code ? ` (${payload.code})` : ""}`,
        tone,
        detail,
      };
    case "context.window": {
      const m = payload.metrics ?? {};
      const used = m.tokenUpperBound ?? 0;
      const budget = (m.contextTokens ?? 0) - (m.maxOutputTokens ?? 0);
      return {
        text: `Context window: ${payload.count ?? m.messages ?? "?"} messages, ≤${formatCount(used)} tokens${budget > 0 ? ` (${((used / budget) * 100).toFixed(1)}% of ${formatCount(budget)})` : ""}${get("added") ? ` — added ${get("added")}` : ""}`,
        tone: state === "over-limit" ? "error" : "default",
        detail: [
          m.instructionsBytes !== undefined && `instructions ${formatBytes(m.instructionsBytes)}`,
          m.taskBytes !== undefined && `task ${formatBytes(m.taskBytes)}`,
          m.assistantBytes !== undefined &&
            `model actions ${formatBytes(m.assistantBytes)} (${m.assistantMessages ?? 0})`,
          m.observationBytes !== undefined &&
            `observations ${formatBytes(m.observationBytes)} (${m.observationMessages ?? 0})`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "context.limit":
      return {
        text: "Context window full — the session stops (nothing is compressed)",
        tone: "error",
        detail,
      };
    case "notebook.updated":
      return {
        text:
          state === "full"
            ? "Notebook full: the note was not kept"
            : `Notebook: ${payload.metrics?.entries ?? payload.count ?? "?"} entries, ${formatBytes(payload.metrics?.bytes ?? 0)}`,
        tone: state === "full" ? "warning" : "success",
        detail:
          (refs.get("") ?? []).length > 0 ? `evidence: ${(refs.get("") ?? []).join(", ")}` : null,
      };
    case "artifact.stored":
      return {
        text: `Artifact stored: ${get("kind") ?? "?"} #${short(get("artifact"))}, ${formatBytes(payload.metrics?.bytes ?? 0)}`,
        tone: "success",
        detail:
          [
            get("media"),
            get("digest") && `sha256 ${get("digest")}…`,
            get("source") && `from ${get("source")}`,
          ]
            .filter(Boolean)
            .join("\n") || null,
      };
    case "artifacts.collected":
      return {
        text: `Run collected ${payload.count ?? 0} artifact${payload.count === 1 ? "" : "s"}${payload.metrics?.bytes ? ` (${formatBytes(payload.metrics.bytes)})` : ""}`,
        tone: "primary",
        detail: (refs.get("artifact") ?? []).map((id) => `artifact ${id}`).join("\n") || null,
      };
    case "context.composed":
      return {
        text: `Context composed: ${state ?? "?"}${payload.metrics ? ` — ${payload.metrics.included ?? 0} fragments, ${payload.metrics.droppedForSize ?? 0} dropped to fit` : ""}${payload.code ? ` (${payload.code})` : ""}`,
        tone: state === "ready" ? "success" : "warning",
        detail:
          [
            ...(refs.get("dropped") ?? []).map((id) => `dropped ${id}`),
            ...(refs.get("omitted") ?? []).map((id) => `omitted ${id}`),
          ].join("\n") || null,
      };
    case "context.compressed":
      return {
        text:
          state === "prepared"
            ? `Context compressed: ${payload.metrics?.replaced ?? 0} observations → 1 summary, ${formatCount(payload.metrics?.beforeTokens ?? 0)} → ${formatCount(payload.metrics?.afterTokens ?? 0)} tokens`
            : `Context not compressed: ${state ?? "?"}${payload.code ? ` (${payload.code})` : ""}`,
        tone: state === "prepared" ? "success" : "warning",
        detail: (refs.get("replaced") ?? []).map((id) => `replaced ${id}`).join("\n") || null,
      };
    case "memory.recalled":
      return {
        text: `Memory recall “${get("topic") ?? "?"}”: ${payload.metrics?.recalled ?? 0} recalled, ${payload.metrics?.skipped ?? 0} stale`,
        tone,
        detail:
          [
            ...(refs.get("recalled") ?? []).map((id) => `recalled ${id}`),
            ...(refs.get("skipped") ?? []).map((id) => `skipped ${id}`),
          ].join("\n") || null,
      };
    case "agent.outcome":
      return {
        text: `Agent finished: ${state ?? "?"}${get("reason") ? ` (${get("reason")})` : ""}`,
        tone,
        detail,
      };
  }
  if (event.type === "operation.started")
    return { text: `Started ${payload.operation ?? ""}`, tone: "default", detail };
  if (event.type === "operation.completed")
    return { text: `Completed ${payload.operation ?? ""}`, tone: "default", detail };
  if (event.type === "operation.failed")
    return { text: `Failed ${payload.operation ?? ""}`, tone: "error", detail };
  if (payload.summary && !payload.operation)
    return { text: payload.summary, tone: "primary", detail: null };
  return {
    text: [payload.operation ?? event.type, state].filter(Boolean).join(": "),
    tone,
    detail,
  };
}

/** Run totals for the summary strip. */
export function traceStats(root: TraceNode, events: readonly RecordedDebugEventDto[]): TraceStats {
  let steps = 0;
  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  const walk = (span: TraceNode) => {
    if (span.kind === "step") steps++;
    if (span.kind === "turn") turns++;
    if (span.kind === "model") modelCalls++;
    if (span.kind === "tool") toolCalls++;
    span.children.forEach(walk);
  };
  walk(root);
  let inputTokens = 0;
  let outputTokens = 0;
  let warnings = 0;
  let errors = 0;
  const models = new Set<string>();
  for (const { event } of events) {
    if (event.level === "warn") warnings++;
    if (event.level === "error") errors++;
    if (event.payload.operation !== "model.reply") continue;
    const refs = parseRefs(event.payload.relatedRefs);
    inputTokens += Number(refs.get("inputTokens")?.[0] ?? 0);
    outputTokens += Number(refs.get("outputTokens")?.[0] ?? 0);
    const model = refs.get("model")?.[0];
    if (model) models.add(model);
  }
  return {
    durationMs: root.durationMs ?? 0,
    steps,
    turns,
    modelCalls,
    toolCalls,
    inputTokens,
    outputTokens,
    warnings,
    errors,
    models: [...models],
  };
}

/** Spans in display order, skipping the children of collapsed ones. */
export function visibleSpans(
  root: TraceNode,
  collapsed: ReadonlySet<string>,
  keep?: ReadonlySet<string>,
): TraceNode[] {
  const rows: TraceNode[] = [];
  const walk = (span: TraceNode) => {
    if (keep && !keep.has(span.id)) return;
    rows.push(span);
    if (!collapsed.has(span.id)) span.children.forEach(walk);
  };
  root.children.forEach(walk);
  return rows;
}

/** Spans whose title, refs or events match the query, with their ancestors; null when no query. */
export function matchingSpans(root: TraceNode, query: string): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const keep = new Set<string>();
  const walk = (span: TraceNode, ancestors: readonly string[]): void => {
    const text = [
      span.title,
      span.subtitle,
      span.operation,
      ...span.badges.map((badge) => badge.text),
      ...[...span.refs.entries()].flatMap(([key, values]) =>
        values.map((value) => `${key}:${value}`),
      ),
      ...span.events.map(({ event }) => describeEvent(event).text),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (text.includes(needle)) for (const id of [...ancestors, span.id]) keep.add(id);
    for (const child of span.children) walk(child, [...ancestors, span.id]);
  };
  for (const child of root.children) walk(child, []);
  return keep;
}

/** Ids of spans that start collapsed: turns and everything below them stay folded. */
export function defaultCollapsed(root: TraceNode): Set<string> {
  const ids = new Set<string>();
  const walk = (span: TraceNode) => {
    if (span.kind === "turn" && span.children.length > 0) ids.add(span.id);
    span.children.forEach(walk);
  };
  walk(root);
  return ids;
}

export function allSpanIds(root: TraceNode): Set<string> {
  const ids = new Set<string>();
  const walk = (span: TraceNode) => {
    if (span.children.length > 0) ids.add(span.id);
    span.children.forEach(walk);
  };
  root.children.forEach(walk);
  return ids;
}

/** Ids of the spans enclosing `id`, outermost first; empty when it is not in the tree. */
export function ancestorIds(root: TraceNode, id: string): string[] {
  const walk = (span: TraceNode, path: string[]): string[] | null => {
    if (span.id === id) return path;
    for (const child of span.children) {
      const found = walk(child, [...path, span.id]);
      if (found) return found;
    }
    return null;
  };
  return (walk(root, []) ?? []).filter((ancestor) => ancestor !== "root");
}

export function findSpan(root: TraceNode, id: string): TraceNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findSpan(child, id);
    if (found) return found;
  }
  return null;
}

export function formatCount(value: number): string {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString("en-US");
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
