import {
  Alert,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { AgentRunStatus } from "@kushex/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppIcon } from "../../shared/components/AppIcon";
import {
  BackIcon,
  ContextIcon,
  DebugEventsIcon,
  EventListIcon,
  RefreshIcon,
  SearchIcon,
  TraceIcon,
} from "../../shared/lib/icons";
import { borderB } from "../../shared/lib/styles";
import { paths } from "../workbench/navigation";
import { LEVELS, filterEvents, formatDuration, type DebugLevel } from "./debugEventView";
import {
  allSpanIds,
  ancestorIds,
  buildTrace,
  defaultCollapsed,
  formatCount,
  matchingSpans,
  traceStats,
  type TraceStats,
} from "./debugTrace";
import { buildContextModel } from "./contextModel";
import { ContextView } from "./ContextView";
import { EventList } from "./EventList";
import { TraceView } from "./TraceView";
import { useRunDebugEvents } from "./useRunDebugEvents";

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  starting: "processing",
  running: "processing",
  paused: "warning",
  completed: "success",
  failed: "error",
  cancelled: "default",
};

type View = "trace" | "context" | "events";
/** How the tree folds: the default (turns folded), all open or all closed, plus rows the user flipped. */
type Folding = Readonly<{ base: "default" | "open" | "closed"; flipped: ReadonlySet<string> }>;

/**
 * What kushibot did during one chat run. The trace shows the harness as a tree — agent run,
 * workflow steps, executors, agentic mind units, turns, model and tool calls — and the event
 * list shows every recorded event in order.
 */
export function DebugEventsScreen({
  projectId,
  runId,
}: Readonly<{ projectId: string; runId: string }>) {
  const navigate = useNavigate();
  const { run, recording, events, loading, live, error, refresh } = useRunDebugEvents(runId);
  const [view, setView] = useState<View>("trace");
  const [query, setQuery] = useState("");
  const [minLevel, setMinLevel] = useState<DebugLevel>("trace");
  const [spans, setSpans] = useState(false);
  const [follow, setFollow] = useState(true);
  const [folding, setFolding] = useState<Folding>({ base: "default", flipped: new Set() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<string | null>(null);

  const root = useMemo(() => buildTrace(events), [events]);
  const stats = useMemo(() => traceStats(root, events), [root, events]);
  const context = useMemo(() => buildContextModel(root, events), [root, events]);
  const keep = useMemo(() => matchingSpans(root, query), [root, query]);
  const collapsed = useMemo(() => {
    const base =
      folding.base === "default"
        ? defaultCollapsed(root)
        : folding.base === "closed"
          ? allSpanIds(root)
          : new Set<string>();
    for (const id of folding.flipped) if (!base.delete(id)) base.add(id);
    return base;
  }, [root, folding]);
  const shown = useMemo(
    () => filterEvents(events, { minLevel, query, spans }),
    [events, minLevel, query, spans],
  );
  const first = events[0]?.event.occurredAtEpochMs ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  // Until something is picked, the inspector shows the agent run.
  const selected = selectedId ?? root.children[0]?.id ?? "root";

  useEffect(() => {
    if (view === "events" && follow && live) bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [view, follow, live, shown.length]);

  const toggle = (id: string) =>
    setFolding(({ base, flipped }) => {
      const next = new Set(flipped);
      if (!next.delete(id)) next.add(id);
      return { base, flipped: next };
    });

  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <header
        className={`kx:flex kx:shrink-0 kx:flex-col kx:gap-3 kx:px-4 kx:pt-3 kx:pb-3 ${borderB}`}
      >
        <div className="kx:flex kx:flex-wrap kx:items-center kx:gap-2">
          <Tooltip title="Back to files">
            <Button
              type="text"
              size="small"
              onClick={() => void navigate(paths.files(projectId))}
              icon={<AppIcon icon={BackIcon} label="Back to files" />}
            />
          </Tooltip>
          <AppIcon icon={DebugEventsIcon} />
          <Typography.Title level={5} className="kx:m-0">
            Run trace
          </Typography.Title>
          {run && (
            <>
              <span className="kx:text-text-muted">·</span>
              <span className="kx:font-semibold">{run.agentName}</span>
              {run.status ? (
                <Tag bordered={false} color={STATUS_COLORS[run.status]} className="kx:m-0">
                  {run.status}
                </Tag>
              ) : (
                <Tooltip title="The server no longer holds this run; its stored events remain.">
                  <Tag bordered={false} className="kx:m-0">
                    ended
                  </Tag>
                </Tooltip>
              )}
              <span className="kx:text-xs kx:text-text-muted">
                started {new Date(run.startedAt).toLocaleString()}
              </span>
            </>
          )}
          <div className="kx:ml-auto kx:flex kx:items-center kx:gap-2 kx:text-xs kx:text-text-muted">
            {live && (
              <span className="kx:inline-flex kx:items-center kx:gap-1.5">
                <span className="kx:size-1.5 kx:animate-pulse kx:rounded-full kx:bg-primary" />
                live
              </span>
            )}
            <span aria-label="Event count">
              {events.length} {events.length === 1 ? "event" : "events"}
            </span>
            <Tooltip title="Fetch new events">
              <Button
                type="text"
                size="small"
                onClick={refresh}
                icon={<AppIcon icon={RefreshIcon} label="Refresh" />}
              />
            </Tooltip>
          </div>
        </div>
        {events.length > 0 && <StatsStrip stats={stats} />}
        <div className="kx:flex kx:flex-wrap kx:items-center kx:gap-3">
          <Segmented<View>
            size="small"
            value={view}
            onChange={setView}
            options={[
              { value: "trace", label: <ViewLabel icon={TraceIcon} text="Trace" /> },
              { value: "context", label: <ViewLabel icon={ContextIcon} text="Context" /> },
              { value: "events", label: <ViewLabel icon={EventListIcon} text="All events" /> },
            ]}
          />
          {view !== "context" && (
            <Input
              allowClear
              size="small"
              aria-label="Filter"
              placeholder={
                view === "trace"
                  ? "Find a step, executor, tool, model…"
                  : "Filter by text, operation, ref or id"
              }
              prefix={<AppIcon icon={SearchIcon} size="sm" />}
              className="kx:max-w-80 kx:min-w-48 kx:flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          {view === "context" ? null : view === "trace" ? (
            <span className="kx:flex kx:items-center kx:gap-1">
              <Button
                size="small"
                type="text"
                onClick={() => setFolding({ base: "open", flipped: new Set() })}
              >
                Expand all
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => setFolding({ base: "default", flipped: new Set() })}
              >
                Fold turns
              </Button>
            </span>
          ) : (
            <>
              <Select
                size="small"
                aria-label="Lowest level"
                value={minLevel}
                onChange={setMinLevel}
                className="kx:w-32"
                options={LEVELS.map((level) => ({ value: level, label: `${level} and up` }))}
              />
              <span className="kx:inline-flex kx:items-center kx:gap-1.5 kx:text-xs kx:text-text-muted">
                <Switch
                  size="small"
                  checked={spans}
                  onChange={setSpans}
                  aria-label="Show span starts"
                />
                Span starts
              </span>
              <span className="kx:inline-flex kx:items-center kx:gap-1.5 kx:text-xs kx:text-text-muted">
                <Switch size="small" checked={follow} onChange={setFollow} aria-label="Follow" />
                Follow
              </span>
            </>
          )}
        </div>
      </header>
      {(error || !recording) && (
        <div className="kx:px-4 kx:pt-3">
          {error && <Alert className="kx:mb-3" type="error" showIcon title={error} />}
          {!recording && (
            <Alert
              className="kx:mb-3"
              type="info"
              showIcon
              title="Debug events are not recorded"
              description="The server needs kushibot to record them: set KUSHEX_KUSHIBOT_DIR to a built kushibot checkout."
            />
          )}
        </div>
      )}
      <div className="kx:min-h-0 kx:flex-1">
        {loading ? (
          <Spin className="kx:mt-12 kx:block" />
        ) : events.length === 0 ? (
          <Empty
            className="kx:mt-12"
            description={
              live
                ? "Waiting for the agent's first debug event…"
                : "This run recorded no debug events. Agents record them by passing request.debug to kushibot's AgentRuntimeFactory as `debug`."
            }
          />
        ) : view === "context" ? (
          <ContextView
            model={context}
            selectedTurn={selectedTurn}
            onSelectTurn={setSelectedTurn}
            onOpenTrace={(spanId) => {
              // Unfold the span's ancestors so the row is visible, then select it.
              const folded = defaultCollapsed(root);
              setQuery("");
              setFolding({
                base: "default",
                flipped: new Set(ancestorIds(root, spanId).filter((id) => folded.has(id))),
              });
              setSelectedId(spanId);
              setView("trace");
            }}
          />
        ) : view === "trace" ? (
          <TraceView
            root={root}
            collapsed={collapsed}
            keep={keep}
            selectedId={selected}
            onToggle={toggle}
            onSelect={setSelectedId}
          />
        ) : (
          <div className="kx:h-full kx:overflow-auto kx:px-4 kx:py-3">
            {shown.length === 0 ? (
              <Empty className="kx:mt-12" description="No events match the filter." />
            ) : (
              <EventList events={shown} first={first} />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function ViewLabel({ icon, text }: Readonly<{ icon: typeof TraceIcon; text: string }>) {
  return (
    <span className="kx:inline-flex kx:items-center kx:gap-1.5 kx:px-1">
      <AppIcon icon={icon} size="sm" />
      {text}
    </span>
  );
}

function StatsStrip({ stats }: Readonly<{ stats: TraceStats }>) {
  const items: readonly (readonly [string, string, string?])[] = [
    ["Duration", formatDuration(stats.durationMs)],
    ["Steps", String(stats.steps)],
    ["Turns", String(stats.turns)],
    ["Model calls", String(stats.modelCalls), stats.models.join(", ") || undefined],
    ["Tool calls", String(stats.toolCalls)],
    ["Tokens", `${formatCount(stats.inputTokens)} in · ${formatCount(stats.outputTokens)} out`],
  ];
  return (
    <dl aria-label="Run summary" className="kx:m-0 kx:flex kx:flex-wrap kx:gap-2">
      {items.map(([label, value, hint]) => (
        <Tooltip key={label} title={hint}>
          <div className="kx:flex kx:min-w-24 kx:flex-col kx:rounded-lg kx:bg-fill kx:px-3 kx:py-1.5">
            <dt className="kx:text-[11px] kx:text-text-muted">{label}</dt>
            <dd className="kx:m-0 kx:text-sm kx:font-semibold kx:tabular-nums">{value}</dd>
          </div>
        </Tooltip>
      ))}
      {stats.warnings + stats.errors > 0 && (
        <div className="kx:flex kx:min-w-24 kx:flex-col kx:rounded-lg kx:bg-warning/10 kx:px-3 kx:py-1.5">
          <dt className="kx:text-[11px] kx:text-text-muted">Issues</dt>
          <dd className="kx:m-0 kx:text-sm kx:font-semibold">
            <span className="kx:text-warning">{stats.warnings} warn</span>
            {stats.errors > 0 && <span className="kx:text-error"> · {stats.errors} error</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}
