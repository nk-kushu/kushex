import { Empty, Tag, Tooltip } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import type { RecordedDebugEventDto } from "@kushex/contracts";
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import { AppIcon } from "../../shared/components/AppIcon";
import { borderB, borderL } from "../../shared/lib/styles";
import {
  KIND_INFO,
  describeEvent,
  findSpan,
  visibleSpans,
  type Badge,
  type TraceNode,
} from "./debugTrace";
import { formatDuration, formatOffset } from "./debugEventView";
import { KIND_STYLES, TONE_DOTS, TONE_TAGS } from "./traceStyles";

type TraceViewProps = Readonly<{
  root: TraceNode;
  collapsed: ReadonlySet<string>;
  /** Spans kept by the search, or null for all. */
  keep: ReadonlySet<string> | null;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}>;

/** kushibot's span tree as an indented, collapsible waterfall beside an inspector. */
export function TraceView({
  root,
  collapsed,
  keep,
  selectedId,
  onToggle,
  onSelect,
}: TraceViewProps) {
  const rows = useMemo(
    () => visibleSpans(root, keep ? new Set() : collapsed, keep ?? undefined),
    [root, collapsed, keep],
  );
  const selected = findSpan(root, selectedId) ?? root;
  const total = Math.max(1, root.durationMs ?? 1);

  return (
    <div className="kx:grid kx:h-full kx:min-h-0 kx:grid-cols-1 kx:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] kx:lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] kx:lg:grid-rows-1">
      <div className="kx:min-h-0 kx:overflow-auto">
        <div
          className={`kx:sticky kx:top-0 kx:z-10 kx:flex kx:items-center kx:gap-3 kx:bg-surface kx:px-4 kx:py-1.5 kx:text-[11px] kx:font-medium kx:tracking-wide kx:text-text-muted kx:uppercase ${borderB}`}
        >
          <span className="kx:flex-1">What ran</span>
          <span className="kx:w-16 kx:text-right">Took</span>
          <span className="kx:hidden kx:w-28 kx:md:block">When</span>
        </div>
        {rows.length === 0 ? (
          <Empty
            className="kx:mt-12"
            description={
              keep ? "No step, call or event matches the filter." : "No operations recorded yet."
            }
          />
        ) : (
          <ol aria-label="Trace" className="kx:m-0 kx:list-none kx:p-0 kx:py-1">
            {rows.map((span) => (
              <SpanRow
                key={span.id}
                span={span}
                runStart={root.startMs}
                total={total}
                open={keep !== null || !collapsed.has(span.id)}
                selected={span.id === selected.id}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </ol>
        )}
        {root.events.length > 0 && !keep && (
          <div className="kx:px-4 kx:pt-2 kx:pb-4">
            <button
              type="button"
              onClick={() => onSelect("root")}
              className="kx:cursor-pointer kx:border-0 kx:bg-transparent kx:p-0 kx:text-xs kx:text-text-muted kx:hover:text-primary"
            >
              {root.events.length} run-level {root.events.length === 1 ? "event" : "events"} outside
              any operation →
            </button>
          </div>
        )}
      </div>
      <aside
        aria-label="Span details"
        className={`kx:min-h-0 kx:overflow-auto kx:bg-surface-muted ${borderL} kx:max-lg:border-t kx:max-lg:border-l-0 kx:max-lg:border-solid kx:max-lg:border-border`}
      >
        <Inspector span={selected} runStart={root.startMs} onSelect={onSelect} />
      </aside>
    </div>
  );
}

function SpanRow({
  span,
  runStart,
  total,
  open,
  selected,
  onToggle,
  onSelect,
}: Readonly<{
  span: TraceNode;
  runStart: number;
  total: number;
  open: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}>) {
  const style = KIND_STYLES[span.kind];
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const left = ((span.startMs - runStart) / total) * 100;
  const width = (((span.endMs ?? runStart + total) - span.startMs) / total) * 100;
  const hasChildren = span.children.length > 0;
  return (
    <li ref={row}>
      <div
        className={`kx:group kx:flex kx:items-center kx:gap-3 kx:px-4 kx:py-1 ${selected ? "kx:bg-primary/10" : "kx:hover:bg-fill"}`}
      >
        <div
          className="kx:flex kx:min-w-0 kx:flex-1 kx:items-center kx:gap-1.5"
          style={{ paddingLeft: (span.depth - 1) * 18 }}
        >
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={hasChildren ? open : undefined}
            disabled={!hasChildren}
            onClick={() => onToggle(span.id)}
            className={`kx:inline-flex kx:size-5 kx:shrink-0 kx:items-center kx:justify-center kx:rounded kx:border-0 kx:bg-transparent kx:p-0 kx:text-text-muted ${hasChildren ? "kx:cursor-pointer kx:hover:bg-fill" : "kx:opacity-0"}`}
          >
            <span
              className={`kx:inline-flex kx:transition-transform ${open ? "kx:rotate-90" : ""}`}
            >
              <AppIcon icon={IconChevronRight} size="sm" />
            </span>
          </button>
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(span.id)}
            className="kx:flex kx:min-w-0 kx:flex-1 kx:cursor-pointer kx:items-center kx:gap-2 kx:border-0 kx:bg-transparent kx:p-0 kx:text-left kx:text-text"
          >
            <span
              className={`kx:inline-flex kx:size-6 kx:shrink-0 kx:items-center kx:justify-center kx:rounded-md ${style.chip} ${style.text}`}
            >
              <AppIcon icon={style.icon} size="sm" />
            </span>
            <span className="kx:flex kx:min-w-0 kx:flex-1 kx:items-baseline kx:gap-2">
              <span
                className={`kx:shrink-0 kx:text-[13px] kx:whitespace-nowrap ${span.kind === "turn" || span.kind === "model" || span.kind === "tool" ? "" : "kx:font-semibold"}`}
              >
                {span.title}
              </span>
              {span.subtitle && (
                <span className="kx:truncate kx:text-xs kx:text-text-muted">{span.subtitle}</span>
              )}
            </span>
            <Badges badges={span.badges} />
            {span.status === "running" && (
              <span className="kx:inline-flex kx:items-center kx:gap-1 kx:text-[11px] kx:text-primary">
                <span className="kx:size-1.5 kx:animate-pulse kx:rounded-full kx:bg-primary" />
                running
              </span>
            )}
          </button>
        </div>
        <span className="kx:w-16 kx:shrink-0 kx:text-right kx:font-mono kx:text-xs kx:text-text-muted kx:tabular-nums">
          {span.durationMs === null ? "…" : formatDuration(span.durationMs)}
        </span>
        <Tooltip
          title={`${formatOffset(span.startMs - runStart)} → ${span.endMs === null ? "still running" : formatOffset(span.endMs - runStart)}`}
        >
          <span className="kx:relative kx:hidden kx:h-2 kx:w-28 kx:shrink-0 kx:rounded-full kx:bg-fill kx:md:block">
            <span
              className={`kx:absolute kx:inset-y-0 kx:rounded-full ${style.bar} ${span.status === "running" ? "kx:animate-pulse" : ""} ${span.status === "failed" ? "kx:bg-error" : ""}`}
              style={{
                left: `${Math.min(100, Math.max(0, left))}%`,
                width: `max(3px, ${Math.min(100 - left, Math.max(0, width))}%)`,
              }}
            />
          </span>
        </Tooltip>
      </div>
    </li>
  );
}

function Badges({ badges }: Readonly<{ badges: readonly Badge[] }>) {
  if (badges.length === 0) return null;
  return (
    <span className="kx:flex kx:min-w-0 kx:items-center kx:gap-1 kx:overflow-hidden">
      {badges.map((badge) => (
        <Tooltip key={badge.text} title={badge.hint}>
          <Tag bordered={false} color={TONE_TAGS[badge.tone]} className="kx:m-0 kx:text-[11px]">
            {badge.text}
          </Tag>
        </Tooltip>
      ))}
    </span>
  );
}

type Entry =
  | Readonly<{ at: number; kind: "event"; item: RecordedDebugEventDto }>
  | Readonly<{ at: number; kind: "child"; span: TraceNode }>;

function Inspector({
  span,
  runStart,
  onSelect,
}: Readonly<{ span: TraceNode; runStart: number; onSelect: (id: string) => void }>) {
  const style = KIND_STYLES[span.kind];
  const info = KIND_INFO[span.kind];
  const entries: Entry[] = [
    ...span.events.map((item) => ({
      at: item.event.occurredAtEpochMs,
      kind: "event" as const,
      item,
    })),
    ...span.children.map((child) => ({ at: child.startMs, kind: "child" as const, span: child })),
  ].sort((a, b) => a.at - b.at);
  const facts: readonly (readonly [string, string | undefined | null])[] = [
    ["Started", formatOffset(span.startMs - runStart)],
    [
      "Took",
      span.durationMs === null
        ? span.kind === "root"
          ? null
          : "still running"
        : formatDuration(span.durationMs),
    ],
    ["Step run", span.identity.stepRunId],
    ["Session", span.identity.sessionId],
    ["Operation", span.identity.operationId],
    ["Span", span.kind === "root" ? null : span.id],
  ];
  const refs = [...span.refs.entries()].filter(([key]) => key !== "operation");
  const raw = [span.start, ...span.events, span.end].filter(
    (item): item is RecordedDebugEventDto => item !== null,
  );

  return (
    <div className="kx:flex kx:flex-col kx:gap-4 kx:p-4">
      <div className="kx:flex kx:items-start kx:gap-3">
        <span
          className={`kx:inline-flex kx:size-9 kx:shrink-0 kx:items-center kx:justify-center kx:rounded-lg ${style.chip} ${style.text}`}
        >
          <AppIcon icon={style.icon} size="lg" />
        </span>
        <div className="kx:flex kx:min-w-0 kx:flex-col kx:gap-0.5">
          <span
            className={`kx:text-[11px] kx:font-medium kx:tracking-wide kx:uppercase ${style.text}`}
          >
            {info.label}
          </span>
          <span className="kx:text-base kx:font-semibold kx:break-words">{span.title}</span>
          {span.subtitle && (
            <span className="kx:text-xs kx:break-words kx:text-text-muted">{span.subtitle}</span>
          )}
        </div>
      </div>
      {span.badges.length > 0 && (
        <div className="kx:flex kx:flex-wrap kx:gap-1">
          {span.badges.map((badge) => (
            <Tag key={badge.text} bordered={false} color={TONE_TAGS[badge.tone]} className="kx:m-0">
              {badge.text}
              {badge.hint && badge.hint !== "Tokens" ? ` — ${badge.hint}` : ""}
            </Tag>
          ))}
        </div>
      )}
      <p className="kx:m-0 kx:text-xs kx:leading-relaxed kx:text-text-muted">{info.about}</p>

      <dl className="kx:m-0 kx:grid kx:grid-cols-[max-content_1fr] kx:gap-x-4 kx:gap-y-1 kx:text-xs">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className="kx:text-text-muted">{label}</dt>
              <dd className="kx:m-0 kx:font-mono kx:break-all">{value}</dd>
            </Fragment>
          ))}
      </dl>

      {refs.length > 0 && (
        <Section title="Details">
          <dl className="kx:m-0 kx:grid kx:grid-cols-[max-content_1fr] kx:gap-x-4 kx:gap-y-1 kx:text-xs">
            {refs.map(([key, values]) => (
              <Fragment key={key}>
                <dt className="kx:text-text-muted">{key || "flag"}</dt>
                <dd className="kx:m-0 kx:flex kx:flex-wrap kx:gap-1">
                  {values.map((value) => (
                    <span
                      key={value}
                      className="kx:rounded kx:bg-fill kx:px-1.5 kx:font-mono kx:text-[11px] kx:break-all"
                    >
                      {value}
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </Section>
      )}

      <Section title={span.kind === "root" ? "Run-level events" : "What happened inside"}>
        {entries.length === 0 ? (
          <span className="kx:text-xs kx:text-text-muted">
            Nothing was recorded inside this span.
          </span>
        ) : (
          <ol className="kx:m-0 kx:flex kx:list-none kx:flex-col kx:gap-1.5 kx:p-0">
            {entries.map((entry) =>
              entry.kind === "child" ? (
                <li key={entry.span.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.span.id)}
                    className="kx:flex kx:w-full kx:cursor-pointer kx:items-center kx:gap-2 kx:rounded-md kx:border-0 kx:bg-surface kx:px-2 kx:py-1 kx:text-left kx:text-text kx:hover:bg-fill"
                  >
                    <Offset ms={entry.at - runStart} />
                    <span className={`kx:inline-flex ${KIND_STYLES[entry.span.kind].text}`}>
                      <AppIcon icon={KIND_STYLES[entry.span.kind].icon} size="sm" />
                    </span>
                    <span className="kx:min-w-0 kx:flex-1 kx:truncate kx:text-xs">
                      <span className="kx:font-medium">{entry.span.title}</span>
                      {entry.span.subtitle && (
                        <span className="kx:text-text-muted"> · {entry.span.subtitle}</span>
                      )}
                    </span>
                    {entry.span.durationMs !== null && (
                      <span className="kx:font-mono kx:text-[11px] kx:text-text-muted">
                        {formatDuration(entry.span.durationMs)}
                      </span>
                    )}
                  </button>
                </li>
              ) : (
                <EventLine
                  key={`${entry.item.streamId}:${entry.item.sequence}`}
                  item={entry.item}
                  offset={entry.at - runStart}
                />
              ),
            )}
          </ol>
        )}
      </Section>

      {raw.length > 0 && (
        <details className="kx:text-xs">
          <summary className="kx:cursor-pointer kx:text-text-muted kx:select-none">
            Raw events ({raw.length})
          </summary>
          <pre className="kx:mt-2 kx:max-h-96 kx:overflow-auto kx:rounded-md kx:bg-fill kx:p-2 kx:font-mono kx:text-[11px]">
            {JSON.stringify(
              raw.map((item) => item.event),
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </div>
  );
}

function EventLine({ item, offset }: Readonly<{ item: RecordedDebugEventDto; offset: number }>) {
  const line = describeEvent(item.event);
  return (
    <li className="kx:flex kx:items-start kx:gap-2 kx:px-2 kx:py-0.5">
      <Offset ms={offset} />
      <span className={`kx:mt-1.5 kx:size-2 kx:shrink-0 kx:rounded-full ${TONE_DOTS[line.tone]}`} />
      <span className="kx:flex kx:min-w-0 kx:flex-col kx:gap-0.5">
        <span className="kx:text-xs kx:break-words">{line.text}</span>
        {line.detail && (
          <span className="kx:text-[11px] kx:break-words kx:whitespace-pre-wrap kx:text-text-muted">
            {line.detail}
          </span>
        )}
      </span>
    </li>
  );
}

function Offset({ ms }: Readonly<{ ms: number }>) {
  return (
    <span className="kx:w-16 kx:shrink-0 kx:pt-px kx:font-mono kx:text-[11px] kx:text-text-muted kx:tabular-nums">
      {formatOffset(ms)}
    </span>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="kx:flex kx:flex-col kx:gap-2">
      <h3 className="kx:m-0 kx:text-[11px] kx:font-medium kx:tracking-wide kx:text-text-muted kx:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
