import { Alert, Button, Empty, Input, Select, Spin, Switch, Tag, Tooltip, Typography } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import type { AgentRunStatus, DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppIcon } from "../../shared/components/AppIcon";
import { BackIcon, DebugEventsIcon, RefreshIcon, SearchIcon } from "../../shared/lib/icons";
import { borderAll, borderB } from "../../shared/lib/styles";
import { paths } from "../workbench/navigation";
import {
  LEVELS,
  countByLevel,
  eventTitle,
  filterEvents,
  formatDuration,
  formatOffset,
  spanPhase,
  type DebugLevel,
} from "./debugEventView";
import { useRunDebugEvents } from "./useRunDebugEvents";

const LEVEL_STYLES: Record<DebugLevel, string> = {
  trace: "kx:bg-fill kx:text-text-muted",
  debug: "kx:bg-fill kx:text-text-muted",
  info: "kx:bg-primary/12 kx:text-primary",
  warn: "kx:bg-warning/15 kx:text-warning",
  error: "kx:bg-error/12 kx:text-error",
};

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  starting: "processing",
  running: "processing",
  paused: "warning",
  completed: "success",
  failed: "error",
  cancelled: "default",
};

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

/** Every kushibot debug event one chat run recorded, as a filterable timeline. */
export function DebugEventsScreen({
  projectId,
  runId,
}: Readonly<{ projectId: string; runId: string }>) {
  const navigate = useNavigate();
  const { run, recording, events, loading, live, error, refresh } = useRunDebugEvents(runId);
  const [minLevel, setMinLevel] = useState<DebugLevel>("trace");
  const [query, setQuery] = useState("");
  const [spans, setSpans] = useState(false);
  const [follow, setFollow] = useState(true);
  const shown = useMemo(
    () => filterEvents(events, { minLevel, query, spans }),
    [events, minLevel, query, spans],
  );
  const counts = useMemo(() => countByLevel(events), [events]);
  const first = events[0]?.event.occurredAtEpochMs ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow && live) bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [follow, live, shown.length]);

  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <header className={`kx:flex kx:shrink-0 kx:flex-col kx:gap-3 kx:px-4 kx:py-3 ${borderB}`}>
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
            Debug events
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
              {counts.warn + counts.error > 0 && (
                <>
                  {" · "}
                  <span className="kx:text-warning">{counts.warn} warn</span>
                  {" · "}
                  <span className="kx:text-error">{counts.error} error</span>
                </>
              )}
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
        <div className="kx:flex kx:flex-wrap kx:items-center kx:gap-3">
          <Input
            allowClear
            size="small"
            aria-label="Filter events"
            placeholder="Filter by type, operation, summary, ref or id"
            prefix={<AppIcon icon={SearchIcon} size="sm" />}
            className="kx:max-w-80 kx:min-w-48 kx:flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
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
        </div>
      </header>
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto kx:px-4 kx:py-3">
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
        ) : shown.length === 0 ? (
          <Empty className="kx:mt-12" description="No events match the filter." />
        ) : (
          <ol
            aria-label="Debug events"
            className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-1 kx:p-0"
          >
            {shown.map((item) => (
              <EventRow
                key={`${item.streamId}:${item.sequence}`}
                item={item}
                offset={item.event.occurredAtEpochMs - first}
              />
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EventRow({ item, offset }: Readonly<{ item: RecordedDebugEventDto; offset: number }>) {
  const [open, setOpen] = useState(false);
  const { event } = item;
  const { payload } = event;
  const phase = spanPhase(event);
  return (
    <li
      className={`kx:rounded-lg ${open ? `kx:bg-surface-muted ${borderAll}` : "kx:border kx:border-solid kx:border-transparent"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="kx:flex kx:w-full kx:cursor-pointer kx:items-start kx:gap-3 kx:rounded-lg kx:border-0 kx:bg-transparent kx:px-2 kx:py-1.5 kx:text-left kx:text-text kx:hover:bg-fill"
      >
        <span
          className={`kx:mt-0.5 kx:inline-flex kx:shrink-0 kx:text-text-muted kx:transition-transform ${open ? "kx:rotate-90" : ""}`}
        >
          <AppIcon icon={IconChevronRight} size="sm" />
        </span>
        <Tooltip title={clock.format(event.occurredAtEpochMs)}>
          <span className="kx:w-20 kx:shrink-0 kx:pt-px kx:font-mono kx:text-xs kx:text-text-muted kx:tabular-nums">
            {formatOffset(offset)}
          </span>
        </Tooltip>
        <span
          className={`kx:w-12 kx:shrink-0 kx:rounded kx:px-1 kx:text-center kx:font-mono kx:text-[10px] kx:leading-5 kx:uppercase ${LEVEL_STYLES[event.level]}`}
        >
          {event.level}
        </span>
        <span className="kx:flex kx:min-w-0 kx:flex-1 kx:flex-col kx:gap-1">
          <span className="kx:flex kx:flex-wrap kx:items-center kx:gap-x-2 kx:gap-y-1">
            <span className="kx:font-mono kx:text-[13px] kx:font-semibold">
              {phase === "start" ? "▸ " : ""}
              {eventTitle(event)}
            </span>
            {event.payload.operation && (
              <span className="kx:font-mono kx:text-xs kx:text-text-muted">{event.type}</span>
            )}
            {payload.durationMs !== undefined && (
              <Tag bordered={false} className="kx:m-0 kx:font-mono kx:text-[11px]">
                {formatDuration(payload.durationMs)}
              </Tag>
            )}
            {payload.nextState && (
              <Tag
                bordered={false}
                color={event.level === "warn" || event.level === "error" ? "warning" : "success"}
                className="kx:m-0 kx:text-[11px]"
              >
                {payload.previousState ? `${payload.previousState} → ` : ""}
                {payload.nextState}
              </Tag>
            )}
            {payload.code && (
              <Tag bordered={false} color="error" className="kx:m-0 kx:font-mono kx:text-[11px]">
                {payload.code}
              </Tag>
            )}
            {payload.count !== undefined && (
              <span className="kx:text-xs kx:text-text-muted">count {payload.count}</span>
            )}
          </span>
          {payload.summary && (
            <span className="kx:text-sm kx:break-words kx:whitespace-pre-wrap">
              {payload.summary}
            </span>
          )}
          {payload.relatedRefs && payload.relatedRefs.length > 0 && (
            <span className="kx:flex kx:flex-wrap kx:gap-1">
              {payload.relatedRefs.map((ref) => (
                <span
                  key={ref}
                  className="kx:rounded kx:bg-fill kx:px-1.5 kx:font-mono kx:text-[11px] kx:text-text-muted"
                >
                  {ref}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {open && <EventDetails item={item} event={event} />}
    </li>
  );
}

function EventDetails({
  item,
  event,
}: Readonly<{ item: RecordedDebugEventDto; event: DebugEventDto }>) {
  const facts: readonly (readonly [string, string | number | null | undefined])[] = [
    ["Stream", item.streamId],
    ["Sequence", item.sequence],
    ["Occurred", new Date(event.occurredAtEpochMs).toISOString()],
    ["Recorded", new Date(item.recordedAtEpochMs).toISOString()],
    ["Event", event.eventId],
    ["Producer", event.producerId],
    ["Span", event.trace.spanId],
    ["Parent span", event.trace.parentSpanId],
    ["Caused by", event.trace.causationEventId],
    ["Trace", event.trace.traceId],
    ["Operation", event.identity.operationId],
    ["Step run", event.identity.stepRunId],
    ["Session", event.identity.sessionId],
    ["Scope", `${event.scope.scopeId} / ${event.scope.projectId}`],
  ];
  return (
    <div className="kx:flex kx:flex-col kx:gap-2 kx:px-3 kx:pt-1 kx:pb-3 kx:pl-9">
      <dl className="kx:m-0 kx:grid kx:grid-cols-[max-content_1fr] kx:gap-x-4 kx:gap-y-0.5 kx:text-xs">
        {facts
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([label, value]) => (
            <div key={label} className="kx:contents">
              <dt className="kx:text-text-muted">{label}</dt>
              <dd className="kx:m-0 kx:font-mono kx:break-all">{value}</dd>
            </div>
          ))}
      </dl>
      <pre className="kx:m-0 kx:max-h-72 kx:overflow-auto kx:rounded-md kx:bg-fill kx:p-2 kx:font-mono kx:text-xs">
        {JSON.stringify(event, null, 2)}
      </pre>
    </div>
  );
}
