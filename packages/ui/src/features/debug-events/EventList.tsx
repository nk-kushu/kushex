import { Tag, Tooltip } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import { useState } from "react";
import { AppIcon } from "../../shared/components/AppIcon";
import { borderAll } from "../../shared/lib/styles";
import { formatDuration, formatOffset, spanPhase, type DebugLevel } from "./debugEventView";
import { describeEvent } from "./debugTrace";
import { TONE_DOTS } from "./traceStyles";

const LEVEL_STYLES: Record<DebugLevel, string> = {
  trace: "kx:bg-fill kx:text-text-muted",
  debug: "kx:bg-fill kx:text-text-muted",
  info: "kx:bg-primary/12 kx:text-primary",
  warn: "kx:bg-warning/15 kx:text-warning",
  error: "kx:bg-error/12 kx:text-error",
};

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

/** Every event in the order kushibot recorded it, each as a sentence with its raw fields on demand. */
export function EventList({
  events,
  first,
}: Readonly<{ events: readonly RecordedDebugEventDto[]; first: number }>) {
  return (
    <ol
      aria-label="Debug events"
      className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-0.5 kx:p-0"
    >
      {events.map((item) => (
        <EventRow
          key={`${item.streamId}:${item.sequence}`}
          item={item}
          offset={item.event.occurredAtEpochMs - first}
        />
      ))}
    </ol>
  );
}

function EventRow({ item, offset }: Readonly<{ item: RecordedDebugEventDto; offset: number }>) {
  const [open, setOpen] = useState(false);
  const { event } = item;
  const { payload } = event;
  const phase = spanPhase(event);
  const line = describeEvent(event);
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
        <span
          className={`kx:mt-1.5 kx:size-2 kx:shrink-0 kx:rounded-full ${phase ? "kx:bg-border" : TONE_DOTS[line.tone]}`}
        />
        <span className="kx:flex kx:min-w-0 kx:flex-1 kx:flex-col kx:gap-0.5">
          <span className="kx:flex kx:flex-wrap kx:items-center kx:gap-x-2 kx:gap-y-1">
            <span className={`kx:text-[13px] ${phase ? "kx:text-text-muted" : "kx:font-medium"}`}>
              {line.text}
            </span>
            {payload.durationMs !== undefined && (
              <Tag bordered={false} className="kx:m-0 kx:font-mono kx:text-[11px]">
                {formatDuration(payload.durationMs)}
              </Tag>
            )}
            <span className="kx:font-mono kx:text-[11px] kx:text-text-muted">
              {payload.operation ? `${payload.operation} · ` : ""}
              {event.type}
            </span>
          </span>
          {line.detail && (
            <span className="kx:text-xs kx:break-words kx:whitespace-pre-wrap kx:text-text-muted">
              {line.detail}
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
    ["Sequence", item.sequence],
    ["Occurred", new Date(event.occurredAtEpochMs).toISOString()],
    ["Span", event.trace.spanId],
    ["Parent span", event.trace.parentSpanId],
    ["Caused by", event.trace.causationEventId],
    ["Operation", event.identity.operationId],
    ["Step run", event.identity.stepRunId],
    ["Session", event.identity.sessionId],
    ["Refs", event.payload.relatedRefs?.join("  ·  ")],
  ];
  return (
    <div className="kx:flex kx:flex-col kx:gap-2 kx:px-3 kx:pt-1 kx:pb-3 kx:pl-9">
      <dl className="kx:m-0 kx:grid kx:grid-cols-[max-content_1fr] kx:gap-x-4 kx:gap-y-0.5 kx:text-xs">
        {facts
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
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
