import { Button, Empty, Segmented, Tag, Tooltip } from "antd";
import { IconArrowNarrowDown } from "@tabler/icons-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "../../shared/components/AppIcon";
import {
  ArtifactIcon,
  ContextIcon,
  MemoryIcon,
  ModelCallIcon,
  NotebookIcon,
  TraceIcon,
} from "../../shared/lib/icons";
import { borderAll, borderB, borderL } from "../../shared/lib/styles";
import { formatDuration } from "./debugEventView";
import { formatBytes, formatCount } from "./debugTrace";
import type {
  ArtifactItem,
  ContextModel,
  ContextSession,
  ContextTurn,
  ContextUnit,
  Segment,
} from "./contextModel";

/** Fixed colors per origin; observations get one color per tool. */
const ORIGIN_COLORS: Readonly<Record<string, string | undefined>> = {
  instructions: "#64748b",
  task: "#9b6cc4",
  assistant: "#4f8fc0",
  base: "#8a8fa8",
  "obs.notebook": "#2f9e5b",
  "obs.correction": "#d14d4d",
  "obs.rejected": "#d14d4d",
};
const TOOL_COLORS = ["#d9734f", "#cb8a00", "#0f8f90", "#c2417a", "#5b8c2a", "#a8652a", "#7c6fd6"];

function colorOf(key: string, tools: readonly string[]): string {
  const known = ORIGIN_COLORS[key];
  if (known) return known;
  const index = tools.indexOf(key);
  return TOOL_COLORS[(index < 0 ? 0 : index) % TOOL_COLORS.length] ?? "#d9734f";
}

function amount(value: number, unit: ContextUnit): string {
  return unit === "bytes" ? formatBytes(value) : `${formatCount(value)} tok`;
}

const percent = (value: number) =>
  `${value < 0.1 ? (value * 100).toFixed(2) : (value * 100).toFixed(1)}%`;

type Scale = "run" | "window";

type ContextViewProps = Readonly<{
  model: ContextModel;
  selectedTurn: string | null;
  onSelectTurn: (spanId: string) => void;
  /** Opens the span in the Trace view. */
  onOpenTrace: (spanId: string) => void;
}>;

/**
 * The context the model worked with, turn by turn: how the window filled up and with what, where
 * notes, artifacts, compression and long-term memory came in, and what one step handed the next.
 */
export function ContextView({ model, selectedTurn, onSelectTurn, onOpenTrace }: ContextViewProps) {
  const [scale, setScale] = useState<Scale>("run");
  const tools = useMemo(() => {
    const keys = new Set<string>();
    for (const session of model.sessions)
      for (const turn of session.turns)
        for (const segment of turn.segments)
          if (segment.key.startsWith("obs.") && !ORIGIN_COLORS[segment.key]) keys.add(segment.key);
    return [...keys];
  }, [model]);
  const turns = model.sessions.flatMap((session) =>
    session.turns.map((turn) => ({ session, turn })),
  );
  const selected = turns.find(({ turn }) => turn.spanId === selectedTurn) ?? turns.at(-1) ?? null;
  const hasWindow = turns.some(({ turn }) => turn.budget !== null);

  if (model.sessions.length === 0)
    return (
      <Empty
        className="kx:mt-12"
        description="No agentic session recorded yet: the context view fills in once a mind unit runs its first turn."
      />
    );

  return (
    <div className="kx:grid kx:h-full kx:min-h-0 kx:grid-cols-1 kx:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] kx:lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] kx:lg:grid-rows-1">
      <div className="kx:min-h-0 kx:overflow-auto kx:px-4 kx:py-3">
        <ConceptStrip model={model} />
        <div className="kx:mt-4 kx:mb-2 kx:flex kx:flex-wrap kx:items-center kx:gap-3">
          <Legend model={model} tools={tools} />
          {hasWindow && (
            <Segmented<Scale>
              size="small"
              className="kx:ml-auto"
              value={scale}
              onChange={setScale}
              options={[
                { value: "run", label: "Fit to run" },
                { value: "window", label: "Model window" },
              ]}
            />
          )}
        </div>
        {!model.measured && (
          <p className="kx:m-0 kx:mb-3 kx:rounded-md kx:bg-warning/10 kx:px-3 kx:py-2 kx:text-xs kx:text-text-muted">
            This run was recorded before kushibot measured its context window, so the composition is{" "}
            <b>estimated from the provider's input tokens</b>: the first call is the base, and each
            later increase is credited to the previous turn's action and its result. New runs record
            exact sizes per message.
          </p>
        )}
        {model.sessions.map((session, index) => (
          <Fragment key={session.spanId}>
            {index > 0 && <Handoff from={model.sessions[index - 1]!} to={session} />}
            <SessionBlock
              session={session}
              scale={scale}
              tools={tools}
              runPeak={Math.max(
                ...model.sessions.filter((s) => s.unit === session.unit).map((s) => s.peak),
                1,
              )}
              selected={selected?.turn.spanId ?? null}
              onSelect={onSelectTurn}
            />
          </Fragment>
        ))}
        <ArtifactsPanel model={model} onOpenTrace={onOpenTrace} />
        <MachineryPanel model={model} onOpenTrace={onOpenTrace} />
      </div>
      <aside
        aria-label="Turn context details"
        className={`kx:min-h-0 kx:overflow-auto kx:bg-surface-muted ${borderL} kx:max-lg:border-t kx:max-lg:border-l-0 kx:max-lg:border-solid kx:max-lg:border-border`}
      >
        {selected && (
          <TurnInspector
            session={selected.session}
            turn={selected.turn}
            tools={tools}
            onOpenTrace={onOpenTrace}
          />
        )}
      </aside>
    </div>
  );
}

/** One card per concept with what it did in this run. */
function ConceptStrip({ model }: Readonly<{ model: ContextModel }>) {
  const turns = model.sessions.flatMap((session) => session.turns);
  const fills = turns.map((turn) => turn.fill).filter((fill): fill is number => fill !== null);
  const input = turns.reduce((sum, turn) => sum + (turn.usage?.input ?? 0), 0);
  const cached = turns.reduce((sum, turn) => sum + (turn.usage?.cached ?? 0), 0);
  const peakTokens = Math.max(0, ...turns.map((turn) => turn.usage?.input ?? 0));
  const notes = model.sessions.reduce((sum, session) => sum + session.notebookEntries, 0);
  const artifactBytes = model.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  const compressed = model.compressions.filter((item) => item.state === "prepared").length;
  const recalled = model.recalls.reduce((sum, item) => sum + item.recalled.length, 0);
  const cards: readonly Readonly<{
    icon: typeof ContextIcon;
    color: string;
    title: string;
    value: string;
    about: string;
    muted?: boolean;
  }>[] = [
    {
      icon: ContextIcon,
      color: "#7c6fd6",
      title: "Context window",
      value: fills.length
        ? `peak ${percent(Math.max(...fills))} full`
        : `peak ${formatCount(peakTokens)} tokens`,
      about:
        "Each turn re-sends the whole conversation: instructions, the task, every model action and every tool result so far. It only grows; when it no longer fits the model window the session stops.",
    },
    {
      icon: ModelCallIcon,
      color: "#4f8fc0",
      title: "Prompt cache",
      value: input ? `${percent(cached / input)} of input cached` : "no usage reported",
      about:
        "The provider reuses the unchanged prefix of the conversation. Cached input tokens are cheaper and faster; the growing tail is processed fresh.",
    },
    {
      icon: NotebookIcon,
      color: "#2f9e5b",
      title: "Notebook",
      value: notes ? `${notes} ${notes === 1 ? "entry" : "entries"}` : "no notes written",
      muted: notes === 0,
      about:
        "The session's working memory: short notes the model chooses to keep. They are what a stopped session hands back as its partial summary.",
    },
    {
      icon: ArtifactIcon,
      color: "#0f8f90",
      title: "Artifacts",
      value: model.artifacts.length
        ? `${model.artifacts.length} stored · ${formatBytes(artifactBytes)}`
        : model.collected
          ? `${model.collected.count} collected`
          : "none recorded",
      muted: model.artifacts.length === 0 && !model.collected?.count,
      about:
        "Durable outputs kept outside the context (for example each changed file's before/after). The context and results carry only their ids.",
    },
    {
      icon: ContextIcon,
      color: "#7c6fd6",
      title: "Compression",
      value: model.compressions.length
        ? `${compressed}/${model.compressions.length} applied`
        : model.limitHits
          ? "window full, no compression"
          : "not used",
      muted: model.compressions.length === 0,
      about: model.compressions.length
        ? "Contiguous observations were replaced by a verified summary stored as an artifact, when that measurably shrank the request."
        : "This agent does not wire kushibot's ContextCompressionService: the conversation is kept whole until it hits the window limit.",
    },
    {
      icon: MemoryIcon,
      color: "#2f9e5b",
      title: "Long-term memory",
      value: model.recalls.length ? `${recalled} recalled` : "not used",
      muted: model.recalls.length === 0,
      about: model.recalls.length
        ? "Accepted memories retrieved by topic and re-verified against their sources before entering the context."
        : "This agent does not wire kushibot's MemoryRetrievalService: nothing from earlier runs entered the context.",
    },
  ];
  return (
    <div className="kx:grid kx:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] kx:gap-2">
      {cards.map((card) => (
        <Tooltip key={card.title} title={card.about}>
          <div
            className={`kx:flex kx:min-w-0 kx:cursor-help kx:flex-col kx:gap-0.5 kx:rounded-lg kx:bg-fill kx:px-3 kx:py-2 ${card.muted ? "kx:opacity-60" : ""}`}
          >
            <span className="kx:flex kx:items-center kx:gap-1.5 kx:text-[11px] kx:text-text-muted">
              <span style={{ color: card.color }} className="kx:inline-flex">
                <AppIcon icon={card.icon} size="sm" />
              </span>
              {card.title}
            </span>
            <span className="kx:text-[13px] kx:leading-snug kx:font-semibold">{card.value}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

function Legend({ model, tools }: Readonly<{ model: ContextModel; tools: readonly string[] }>) {
  const items: [string, string][] = model.measured
    ? [
        ["instructions", "Instructions"],
        ["task", "Task input"],
        ["assistant", "Model actions"],
      ]
    : [["base", "Instructions + task (first call)"]];
  for (const key of tools) items.push([key, key.replace(/^obs\.tool\./, "").replace(/^obs\./, "")]);
  return (
    <ul
      aria-label="Legend"
      className="kx:m-0 kx:flex kx:list-none kx:flex-wrap kx:gap-x-3 kx:gap-y-1 kx:p-0 kx:text-xs kx:text-text-muted"
    >
      {items.map(([key, label]) => (
        <li key={key} className="kx:inline-flex kx:items-center kx:gap-1.5">
          <span className="kx:size-2.5 kx:rounded-sm" style={{ background: colorOf(key, tools) }} />
          {label}
        </li>
      ))}
      <li className="kx:inline-flex kx:items-center kx:gap-1.5">
        <span className="kx:size-2.5 kx:rounded-sm" style={addedStyle("#8a8fa8")} />
        new this turn
      </li>
    </ul>
  );
}

function addedStyle(color: string) {
  return {
    background: `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in srgb, ${color} 55%, transparent) 4px 7px)`,
  };
}

function SessionBlock({
  session,
  scale,
  tools,
  runPeak,
  selected,
  onSelect,
}: Readonly<{
  session: ContextSession;
  scale: Scale;
  tools: readonly string[];
  runPeak: number;
  selected: string | null;
  onSelect: (spanId: string) => void;
}>) {
  return (
    <section
      aria-label={`Session ${session.step ?? session.sessionId}`}
      className={`kx:mb-2 kx:rounded-lg ${borderAll}`}
    >
      <header
        className={`kx:flex kx:flex-wrap kx:items-center kx:gap-2 kx:px-3 kx:py-2 ${borderB}`}
      >
        <span className="kx:text-[13px] kx:font-semibold">Step “{session.step ?? "?"}”</span>
        {session.mode && (
          <Tag bordered={false} className="kx:m-0">
            {session.mode}
          </Tag>
        )}
        <span className="kx:text-xs kx:text-text-muted">
          session {session.sessionId.slice(0, 8)} · {session.turns.length}{" "}
          {session.turns.length === 1 ? "turn" : "turns"}
          {session.instructionsBytes !== null &&
            ` · starts with ${formatBytes(session.instructionsBytes)} instructions + ${formatBytes(session.inputBytes ?? 0)} task`}
        </span>
        {session.outcome && (
          <Tag
            bordered={false}
            color={
              session.outcome === "completed" || session.outcome === "accepted"
                ? "success"
                : "warning"
            }
            className="kx:m-0 kx:ml-auto"
          >
            {session.outcome}
          </Tag>
        )}
      </header>
      <ol aria-label="Turns" className="kx:m-0 kx:list-none kx:p-0 kx:py-1">
        {session.turns.map((turn) => (
          <TurnRow
            key={turn.spanId}
            turn={turn}
            max={scale === "window" && turn.budget ? turn.budget : runPeak}
            scale={scale}
            tools={tools}
            selected={turn.spanId === selected}
            onSelect={onSelect}
          />
        ))}
      </ol>
      {session.notebookEntries > 0 && (
        <div className="kx:flex kx:items-center kx:gap-1.5 kx:px-3 kx:pb-2 kx:text-xs kx:text-text-muted">
          <AppIcon icon={NotebookIcon} size="sm" />
          Notebook at the end: {session.notebookEntries} entries ·{" "}
          {formatBytes(session.notebookBytes)}
        </div>
      )}
    </section>
  );
}

function TurnRow({
  turn,
  max,
  scale,
  tools,
  selected,
  onSelect,
}: Readonly<{
  turn: ContextTurn;
  max: number;
  scale: Scale;
  tools: readonly string[];
  selected: boolean;
  onSelect: (spanId: string) => void;
}>) {
  // On the window scale, the bar shows kushibot's size bound against the budget.
  const total =
    scale === "window" && turn.tokenUpperBound !== null ? turn.tokenUpperBound : turn.total;
  const width = Math.max(0.4, Math.min(100, (total / Math.max(1, max)) * 100));
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(turn.spanId)}
        className={`kx:flex kx:w-full kx:cursor-pointer kx:items-center kx:gap-3 kx:border-0 kx:px-3 kx:py-1 kx:text-left kx:text-text ${selected ? "kx:bg-primary/10" : "kx:bg-transparent kx:hover:bg-fill"}`}
      >
        <span className="kx:w-7 kx:shrink-0 kx:font-mono kx:text-xs kx:text-text-muted">
          T{turn.number}
        </span>
        <span className="kx:relative kx:h-4 kx:min-w-0 kx:flex-1 kx:overflow-hidden kx:rounded kx:bg-fill">
          <span
            className="kx:absolute kx:inset-y-0 kx:left-0 kx:flex"
            style={{ width: `${width}%` }}
          >
            {turn.segments.map((segment, index) => (
              <SegmentBar
                key={`${segment.key}-${index}`}
                segment={segment}
                share={turn.total ? segment.value / turn.total : 0}
                unit={turn.unit}
                color={colorOf(segment.key, tools)}
              />
            ))}
          </span>
          {turn.overLimit && (
            <span className="kx:absolute kx:inset-y-0 kx:right-0 kx:w-1 kx:bg-error" />
          )}
        </span>
        <span className="kx:flex kx:w-20 kx:shrink-0 kx:flex-col kx:text-right kx:font-mono kx:text-xs kx:leading-tight kx:tabular-nums">
          {amount(turn.total, turn.unit)}
          {turn.addedValue > 0 && (
            <span className="kx:text-[10px] kx:text-text-muted">
              +{amount(turn.addedValue, turn.unit)}
            </span>
          )}
        </span>
        <Tooltip
          title={
            turn.fill !== null
              ? "Share of the model window this call used"
              : "Share of input tokens served from the provider's prompt cache"
          }
        >
          <span className="kx:hidden kx:w-12 kx:shrink-0 kx:text-right kx:font-mono kx:text-[11px] kx:text-text-muted kx:tabular-nums kx:sm:block">
            {turn.fill !== null
              ? percent(turn.fill)
              : turn.usage && turn.usage.input
                ? `${Math.round((turn.usage.cached / turn.usage.input) * 100)}%`
                : ""}
          </span>
        </Tooltip>
        <span className="kx:flex kx:w-32 kx:shrink-0 kx:items-center kx:gap-1 kx:overflow-hidden kx:text-xs">
          <ActionChip turn={turn} />
          {turn.notebook && (
            <Tooltip
              title={`Notebook: ${turn.notebook.entries} entries, ${formatBytes(turn.notebook.bytes)}`}
            >
              <span className="kx:inline-flex kx:text-[#2f9e5b]">
                <AppIcon icon={NotebookIcon} size="sm" />
              </span>
            </Tooltip>
          )}
          {turn.artifacts.length > 0 && (
            <Tooltip title={`${turn.artifacts.length} artifact(s) stored`}>
              <span className="kx:inline-flex kx:items-center kx:text-[#0f8f90]">
                <AppIcon icon={ArtifactIcon} size="sm" />
                {turn.artifacts.length > 1 && turn.artifacts.length}
              </span>
            </Tooltip>
          )}
        </span>
      </button>
    </li>
  );
}

function SegmentBar({
  segment,
  share,
  unit,
  color,
}: Readonly<{ segment: Segment; share: number; unit: ContextUnit; color: string }>) {
  return (
    <Tooltip
      title={`${segment.added ? "New: " : ""}${segment.label} — ${amount(segment.value, unit)} (${percent(share)})`}
    >
      <span
        className={`kx:h-full ${segment.added ? "kx:outline kx:outline-1 kx:-outline-offset-1 kx:outline-text" : ""}`}
        style={{
          width: `${share * 100}%`,
          minWidth: segment.value > 0 ? 2 : 0,
          ...(segment.added ? addedStyle(color) : { background: color }),
        }}
      />
    </Tooltip>
  );
}

function ActionChip({ turn }: Readonly<{ turn: ContextTurn }>) {
  if (turn.overLimit)
    return (
      <Tag bordered={false} color="error" className="kx:m-0">
        window full
      </Tag>
    );
  const text =
    turn.action === "tool"
      ? `→ ${turn.tool ?? "tool"}`
      : turn.action === "note"
        ? "→ note"
        : turn.action === "final"
          ? `→ final${turn.acceptance ? ` · ${turn.acceptance}` : ""}`
          : turn.action === "invalid"
            ? "invalid action"
            : "…";
  const color =
    turn.action === "final"
      ? turn.acceptance === "accepted"
        ? "success"
        : "warning"
      : turn.action === "invalid" || turn.toolStatus === "failed" || turn.toolStatus === "rejected"
        ? "error"
        : undefined;
  return (
    <Tag bordered={false} color={color} className="kx:m-0 kx:truncate">
      {text}
    </Tag>
  );
}

/** What the accepted result of one step became in the next session. */
function Handoff({ from, to }: Readonly<{ from: ContextSession; to: ContextSession }>) {
  return (
    <div className="kx:my-1 kx:flex kx:items-center kx:gap-2 kx:pl-4 kx:text-xs kx:text-text-muted">
      <span className="kx:inline-flex kx:text-[#9b6cc4]">
        <AppIcon icon={IconArrowNarrowDown} size="sm" />
      </span>
      <span>
        Handoff: “{from.step ?? "?"}” {from.outcome ?? "ended"}
        {from.resultBytes !== null && ` with a ${formatBytes(from.resultBytes)} result`}; the next
        session starts from a fresh context — only the accepted result
        {to.inputBytes !== null && ` (${formatBytes(to.inputBytes)} task input)`} carries over, not
        the conversation.
      </span>
    </div>
  );
}

function TurnInspector({
  session,
  turn,
  tools,
  onOpenTrace,
}: Readonly<{
  session: ContextSession;
  turn: ContextTurn;
  tools: readonly string[];
  onOpenTrace: (spanId: string) => void;
}>) {
  const ordered = [...turn.segments].sort((a, b) => b.value - a.value);
  return (
    <div className="kx:flex kx:flex-col kx:gap-4 kx:p-4">
      <div className="kx:flex kx:items-start kx:gap-2">
        <div className="kx:min-w-0 kx:flex-1">
          <div className="kx:text-[11px] kx:font-medium kx:tracking-wide kx:text-text-muted kx:uppercase">
            Step “{session.step ?? "?"}” · turn {turn.number}
          </div>
          <div className="kx:text-sm kx:font-semibold">
            Context sent to the model: {amount(turn.total, turn.unit)}
          </div>
          {turn.durationMs !== null && (
            <div className="kx:text-xs kx:text-text-muted">
              turn took {formatDuration(turn.durationMs)}
            </div>
          )}
        </div>
        <Tooltip title="Show this turn in the trace">
          <Button
            size="small"
            type="text"
            onClick={() => onOpenTrace(turn.spanId)}
            icon={<AppIcon icon={TraceIcon} label="Show in trace" />}
          />
        </Tooltip>
      </div>

      {turn.budget !== null && turn.tokenUpperBound !== null && (
        <Section title="Window">
          <Meter
            value={turn.tokenUpperBound}
            max={turn.budget}
            color={turn.overLimit ? "#d14d4d" : "#7c6fd6"}
            label={`≤${formatCount(turn.tokenUpperBound)} of ${formatCount(turn.budget)} tokens (${percent(turn.fill ?? 0)})`}
          />
          <p className="kx:m-0 kx:mt-1 kx:text-[11px] kx:text-text-muted">
            kushibot bounds tokens by request bytes + 1 KB; the budget is the model's context minus
            the reply allowance.
          </p>
        </Section>
      )}

      <Section title={turn.unit === "bytes" ? "Composition (measured)" : "Composition (estimated)"}>
        <ul className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-1 kx:p-0">
          {ordered.map((segment, index) => (
            <li
              key={`${segment.key}-${index}`}
              className="kx:flex kx:items-center kx:gap-2 kx:text-xs"
            >
              <span
                className="kx:size-2.5 kx:shrink-0 kx:rounded-sm"
                style={
                  segment.added
                    ? addedStyle(colorOf(segment.key, tools))
                    : { background: colorOf(segment.key, tools) }
                }
              />
              <span className="kx:min-w-0 kx:flex-1 kx:truncate">
                {segment.added && <b>new · </b>}
                {segment.label}
              </span>
              <span className="kx:font-mono kx:tabular-nums">
                {amount(segment.value, turn.unit)}
              </span>
              <span className="kx:w-12 kx:text-right kx:font-mono kx:text-text-muted kx:tabular-nums">
                {turn.total ? percent(segment.value / turn.total) : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {turn.messageList.length > 0 && (
        <Section title={`Messages (${turn.messages ?? turn.messageList.length})`}>
          <ol className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-0.5 kx:p-0">
            {turn.messages !== null && turn.messages > turn.messageList.length && (
              <li className="kx:text-[11px] kx:text-text-muted">
                … {turn.messages - turn.messageList.length} earlier messages
              </li>
            )}
            {turn.messageList.map((message) => {
              const key = message.kind === "observation" ? `obs.${message.source}` : message.kind;
              return (
                <li
                  key={message.index}
                  className={`kx:flex kx:items-center kx:gap-2 kx:rounded kx:px-1 kx:text-xs ${message.added ? "kx:bg-primary/10" : ""}`}
                >
                  <span className="kx:w-6 kx:font-mono kx:text-text-muted">#{message.index}</span>
                  <span
                    className="kx:size-2 kx:shrink-0 kx:rounded-full"
                    style={{ background: colorOf(key, tools) }}
                  />
                  <span className="kx:w-14 kx:text-text-muted">
                    {message.kind === "assistant"
                      ? "model"
                      : message.kind === "task"
                        ? "user"
                        : "user"}
                  </span>
                  <span className="kx:min-w-0 kx:flex-1 kx:truncate">
                    {message.kind === "task"
                      ? "task input"
                      : message.kind === "assistant"
                        ? `action ${message.source}`
                        : `observation ${message.source}`}
                  </span>
                  <span className="kx:font-mono kx:tabular-nums">{formatBytes(message.bytes)}</span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {turn.usage && (
        <Section title="Provider usage">
          <Meter
            value={turn.usage.cached}
            max={Math.max(1, turn.usage.input)}
            color="#4f8fc0"
            label={`${formatCount(turn.usage.cached)} cached of ${formatCount(turn.usage.input)} input tokens`}
          />
          <dl className="kx:m-0 kx:mt-2 kx:grid kx:grid-cols-2 kx:gap-x-3 kx:gap-y-0.5 kx:text-xs">
            <Stat label="Input" value={formatCount(turn.usage.input)} />
            <Stat
              label="Uncached input"
              value={formatCount(turn.usage.input - turn.usage.cached)}
            />
            <Stat label="Output" value={formatCount(turn.usage.output)} />
            <Stat label="Reasoning" value={formatCount(turn.usage.reasoning)} />
          </dl>
        </Section>
      )}

      <Section title="What the turn did">
        <div className="kx:flex kx:flex-wrap kx:items-center kx:gap-1.5 kx:text-xs">
          <ActionChip turn={turn} />
          {turn.toolStatus && <span className="kx:text-text-muted">tool {turn.toolStatus}</span>}
        </div>
        <p className="kx:m-0 kx:mt-1 kx:text-[11px] kx:text-text-muted">
          {turn.action === "tool"
            ? "The tool's result is appended to the context and sent with the next model call."
            : turn.action === "note"
              ? "The note goes into the session notebook; the model sees an acknowledgement next turn."
              : turn.action === "final"
                ? "The final result is checked by the result contract and the acceptance policy."
                : ""}
        </p>
        {turn.notebook && (
          <div className="kx:mt-2 kx:flex kx:items-center kx:gap-1.5 kx:text-xs">
            <span className="kx:inline-flex kx:text-[#2f9e5b]">
              <AppIcon icon={NotebookIcon} size="sm" />
            </span>
            {turn.notebook.full
              ? "Notebook full — note dropped"
              : `Notebook now ${turn.notebook.entries} entries, ${formatBytes(turn.notebook.bytes)}`}
          </div>
        )}
        {turn.artifacts.map((artifact) => (
          <ArtifactLine key={artifact.spanId} artifact={artifact} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section>
      <h3 className="kx:m-0 kx:mb-1.5 kx:text-[11px] kx:font-medium kx:tracking-wide kx:text-text-muted kx:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meter({
  value,
  max,
  color,
  label,
}: Readonly<{ value: number; max: number; color: string; label: string }>) {
  const share = Math.min(1, value / Math.max(1, max));
  return (
    <div>
      <div className="kx:h-2 kx:overflow-hidden kx:rounded-full kx:bg-fill">
        <div
          className="kx:h-full kx:rounded-full"
          style={{ width: `max(2px, ${share * 100}%)`, background: color }}
        />
      </div>
      <div className="kx:mt-1 kx:text-xs kx:tabular-nums">{label}</div>
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <>
      <dt className="kx:text-text-muted">{label}</dt>
      <dd className="kx:m-0 kx:text-right kx:font-mono kx:tabular-nums">{value}</dd>
    </>
  );
}

function ArtifactLine({ artifact }: Readonly<{ artifact: ArtifactItem }>) {
  return (
    <div className="kx:mt-1 kx:flex kx:items-center kx:gap-1.5 kx:text-xs">
      <span className="kx:inline-flex kx:text-[#0f8f90]">
        <AppIcon icon={ArtifactIcon} size="sm" />
      </span>
      <span className="kx:min-w-0 kx:flex-1 kx:truncate">
        {artifact.kind} <span className="kx:font-mono">#{artifact.id.slice(0, 8)}</span>
      </span>
      <span className="kx:font-mono kx:tabular-nums">{formatBytes(artifact.bytes)}</span>
    </div>
  );
}

function ArtifactsPanel({
  model,
  onOpenTrace,
}: Readonly<{ model: ContextModel; onOpenTrace: (spanId: string) => void }>) {
  return (
    <Panel
      icon={ArtifactIcon}
      color="#0f8f90"
      title="Artifacts"
      hint="Stored outside the context; results and the next step see only their ids."
    >
      {model.artifacts.length === 0 ? (
        <p className="kx:m-0 kx:text-xs kx:text-text-muted">
          {model.collected
            ? `No artifact writes were traced; the run collected ${model.collected.count}.`
            : "No artifact writes recorded. Runs recorded before artifact tracing, or that changed no files, show none."}
        </p>
      ) : (
        <table className="kx:w-full kx:border-collapse kx:text-xs">
          <thead>
            <tr className="kx:text-left kx:text-[11px] kx:text-text-muted">
              <th className="kx:py-1 kx:font-medium">Kind</th>
              <th className="kx:py-1 kx:font-medium">Id</th>
              <th className="kx:py-1 kx:font-medium">Written in</th>
              <th className="kx:py-1 kx:text-right kx:font-medium">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.artifacts.map((artifact) => {
              const session = model.sessions.find((s) => s.sessionId === artifact.sessionId);
              return (
                <tr key={artifact.spanId} className={borderB}>
                  <td className="kx:py-1">{artifact.kind}</td>
                  <td className="kx:py-1 kx:font-mono">
                    <Tooltip
                      title={[
                        artifact.id,
                        artifact.media,
                        artifact.digest && `sha256 ${artifact.digest}…`,
                        ...artifact.sources.map((s) => `from ${s}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {artifact.id.slice(0, 12)}
                    </Tooltip>
                  </td>
                  <td className="kx:py-1 kx:text-text-muted">
                    {artifact.turn !== null
                      ? `“${session?.step ?? "?"}” T${artifact.turn}`
                      : "workflow"}
                  </td>
                  <td className="kx:py-1 kx:text-right kx:font-mono kx:tabular-nums">
                    {formatBytes(artifact.bytes)}
                  </td>
                  <td className="kx:py-1 kx:text-right">
                    <Button size="small" type="link" onClick={() => onOpenTrace(artifact.spanId)}>
                      trace
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {model.collected && (
        <p className="kx:m-0 kx:mt-2 kx:text-xs kx:text-text-muted">
          At the end the run returned {model.collected.count} artifact reference
          {model.collected.count === 1 ? "" : "s"} with its result.
        </p>
      )}
    </Panel>
  );
}

/** Compression, composition and long-term memory: shown when used, explained when not. */
function MachineryPanel({
  model,
  onOpenTrace,
}: Readonly<{ model: ContextModel; onOpenTrace: (spanId: string) => void }>) {
  return (
    <div className="kx:grid kx:grid-cols-1 kx:gap-2 kx:xl:grid-cols-2">
      <Panel
        icon={ContextIcon}
        color="#7c6fd6"
        title="Compression & composition"
        hint="kushibot ContextCompressionService · AgentContextComposer"
      >
        {model.compressions.length === 0 && model.compositions.length === 0 ? (
          <p className="kx:m-0 kx:text-xs kx:text-text-muted">
            Not used by this agent. Its sessions append every action and result to one growing
            conversation
            {model.limitHits
              ? `, and ${model.limitHits} session${model.limitHits === 1 ? "" : "s"} stopped because the window was full`
              : "; no session came near the window limit"}
            . Wiring the compression service would replace runs of old observations with a verified
            summary artifact.
          </p>
        ) : (
          <ul className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-2 kx:p-0">
            {model.compressions.map((item) => (
              <li key={item.spanId} className="kx:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kx:cursor-pointer kx:border-0 kx:bg-transparent kx:p-0 kx:text-left kx:text-text kx:hover:text-primary"
                >
                  <b>Compression {item.state}</b>
                  {item.code && ` (${item.code})`}
                </button>
                {item.metrics.beforeTokens !== undefined && (
                  <BeforeAfter
                    before={item.metrics.beforeTokens}
                    after={item.metrics.afterTokens ?? 0}
                  />
                )}
                {item.replaced.length > 0 && (
                  <div className="kx:text-text-muted">
                    {item.replaced.length} observations → 1 summary (
                    {item.metrics.summaryPoints ?? "?"} points)
                  </div>
                )}
              </li>
            ))}
            {model.compositions.map((item) => (
              <li key={item.spanId} className="kx:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kx:cursor-pointer kx:border-0 kx:bg-transparent kx:p-0 kx:text-left kx:text-text kx:hover:text-primary"
                >
                  <b>Composition {item.state}</b>
                  {item.code && ` (${item.code})`}
                </button>
                <div className="kx:text-text-muted">
                  {item.included.length} fragments in · {item.dropped.length} dropped to fit ·{" "}
                  {item.omitted.length} not chosen
                  {item.metrics.tokenUpperBound !== undefined &&
                    ` · ≤${formatCount(item.metrics.tokenUpperBound)} of ${formatCount(item.metrics.maxInputTokens ?? 0)} tokens`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        icon={MemoryIcon}
        color="#2f9e5b"
        title="Long-term memory"
        hint="kushibot's MemoryRetrievalService"
      >
        {model.recalls.length === 0 ? (
          <p className="kx:m-0 kx:text-xs kx:text-text-muted">
            Not used by this agent: no memories from earlier runs were recalled. Within a run, the
            only memory is each session's notebook and the conversation itself.
          </p>
        ) : (
          <ul className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-1 kx:p-0">
            {model.recalls.map((item) => (
              <li key={item.spanId} className="kx:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kx:cursor-pointer kx:border-0 kx:bg-transparent kx:p-0 kx:text-left kx:text-text kx:hover:text-primary"
                >
                  “{item.topic ?? "?"}”: {item.recalled.length} recalled, {item.skipped.length}{" "}
                  stale
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function BeforeAfter({ before, after }: Readonly<{ before: number; after: number }>) {
  const max = Math.max(before, after, 1);
  return (
    <div className="kx:mt-1 kx:flex kx:flex-col kx:gap-0.5">
      {(
        [
          ["before", before, "#8a8fa8"],
          ["after", after, "#7c6fd6"],
        ] as const
      ).map(([label, value, color]) => (
        <div key={label} className="kx:flex kx:items-center kx:gap-2">
          <span className="kx:w-10 kx:text-text-muted">{label}</span>
          <span className="kx:h-2 kx:flex-1 kx:overflow-hidden kx:rounded-full kx:bg-fill">
            <span
              className="kx:block kx:h-full kx:rounded-full"
              style={{ width: `${(value / max) * 100}%`, background: color }}
            />
          </span>
          <span className="kx:w-16 kx:text-right kx:font-mono kx:tabular-nums">
            {formatCount(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  icon,
  color,
  title,
  hint,
  children,
}: Readonly<{
  icon: typeof ContextIcon;
  color: string;
  title: string;
  hint: string;
  children: ReactNode;
}>) {
  return (
    <section className={`kx:mt-2 kx:rounded-lg kx:px-3 kx:py-2 ${borderAll}`}>
      <h3 className="kx:m-0 kx:mb-1.5 kx:flex kx:flex-wrap kx:items-center kx:gap-x-1.5 kx:text-[13px] kx:font-semibold">
        <span className="kx:inline-flex" style={{ color }}>
          <AppIcon icon={icon} size="sm" />
        </span>
        {title}
        <span className="kx:min-w-0 kx:text-[11px] kx:font-normal kx:break-words kx:text-text-muted">{hint}</span>
      </h3>
      {children}
    </section>
  );
}
