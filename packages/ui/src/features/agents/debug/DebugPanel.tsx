import { Button, Input, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DebugCallFrameDto, DebugCommand, DebugValueDto } from "@kushex/contracts";
import { useAppDispatch, useAppSelector } from "../../../app/hooks";
import { errorMessage } from "../../../shared/api/errorMessage";
import {
  useCancelAgentRunMutation,
  useDebugCommandMutation,
  useEvaluateMutation,
} from "../../../shared/api/kushexApi";
import { AppIcon } from "../../../shared/components/AppIcon";
import {
  ContinueIcon,
  PauseIcon,
  RemoveIcon,
  StepIntoIcon,
  StepOutIcon,
  StepOverIcon,
  StopIcon,
} from "../../../shared/lib/icons";
import { borderB } from "../../../shared/lib/styles";
import { locationLabel } from "../../runs/frameLabel";
import {
  debugSessionClosed,
  frameSelected,
  isFinished,
  selectSelectedFrame,
  selectWatches,
  watchAdded,
  watchRemoved,
  type AgentRunState,
} from "../../runs/runsSlice";
import { DebugSection } from "./DebugSection";
import { ValueLabel, ValueTree, type ValueRoot } from "./ValueTree";

const NO_VALUES: ReadonlyMap<string, DebugValueDto> = new Map();

/** VS Code's debugging keys. */
const KEYS: readonly Readonly<{ key: string; shift: boolean; command: DebugCommand | "stop" }>[] = [
  { key: "F5", shift: false, command: "continue" },
  { key: "F5", shift: true, command: "stop" },
  { key: "F6", shift: false, command: "pause" },
  { key: "F10", shift: false, command: "stepOver" },
  { key: "F11", shift: false, command: "stepInto" },
  { key: "F11", shift: true, command: "stepOut" },
];

/**
 * The agent editor's debug side view, like VS Code's Run and Debug view: the controls,
 * variables, watches and call stack of the latest debug run of this agent, then
 * `children` (the breakpoints). Without a run it shows the watches and breakpoints.
 */
export function DebugPanel({
  run,
  onOpenFrame,
  children,
}: Readonly<{
  run: AgentRunState | undefined;
  onOpenFrame: (frame: DebugCallFrameDto) => void;
  children?: ReactNode;
}>) {
  const dispatch = useAppDispatch();
  const selected = useAppSelector(selectSelectedFrame);
  const paused = run?.paused;
  const frame = paused?.frames[selected];

  return (
    <section aria-label="Debugger" className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      {run ? (
        <DebugToolbar key={run.id} run={run} />
      ) : (
        <div className="kx:shrink-0 kx:px-3 kx:py-2">
          <Typography.Text type="secondary" className="kx:text-xs">
            Not debugging. Turn on debugging in the chat and send a message.
          </Typography.Text>
        </div>
      )}
      <DebugSection label="Variables">
        <Variables run={run} frame={frame} />
      </DebugSection>
      <DebugSection label="Watch">
        <Watch run={run} frame={frame} />
      </DebugSection>
      <DebugSection label="Call stack">
        <CallStack
          frames={paused?.frames ?? []}
          selected={selected}
          onSelect={(index, target) => {
            // Selecting a frame shows it in the editor; callers across an await
            // have no frame to select, so they are only shown.
            if (target.id) dispatch(frameSelected(index));
            else onOpenFrame(target);
          }}
        />
      </DebugSection>
      {children}
    </section>
  );
}

/** The run's state and VS Code's debugging buttons and keys. */
function DebugToolbar({ run }: Readonly<{ run: AgentRunState }>) {
  const dispatch = useAppDispatch();
  const [command] = useDebugCommandMutation();
  const [cancel] = useCancelAgentRunMutation();
  const finished = isFinished(run.status);
  const paused = run.paused;

  const act = (action: DebugCommand | "stop") => {
    if (finished) return;
    if (action === "stop") void cancel(run.id);
    else if (action === "pause" ? !paused : !!paused)
      void command({ runId: run.id, command: action });
  };
  useEffect(() => {
    if (finished) return;
    const onKey = (event: KeyboardEvent) => {
      const binding = KEYS.find((key) => key.key === event.key && key.shift === event.shiftKey);
      if (!binding || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      act(binding.command);
    };
    // Capture, so the editor does not handle the keys first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const tool = (
    label: string,
    keys: string,
    icon: typeof ContinueIcon,
    onClick: () => void,
    enabled: boolean,
  ) => (
    <Tooltip title={`${label} (${keys})`}>
      <Button
        type="text"
        size="small"
        disabled={!enabled}
        onClick={onClick}
        icon={<AppIcon icon={icon} label={label} />}
      />
    </Tooltip>
  );

  return (
    <div className="kx:flex kx:shrink-0 kx:flex-wrap kx:items-center kx:gap-1 kx:px-2 kx:py-1">
      <Tag className="kx:m-0" color={paused ? "warning" : finished ? "default" : "processing"}>
        {paused ? `paused on ${paused.reason}` : run.status}
      </Tag>
      <div className="kx:flex kx:items-center">
        {paused || finished
          ? tool("Continue", "F5", ContinueIcon, () => act("continue"), !!paused)
          : tool("Pause", "F6", PauseIcon, () => act("pause"), true)}
        {tool("Step over", "F10", StepOverIcon, () => act("stepOver"), !!paused)}
        {tool("Step into", "F11", StepIntoIcon, () => act("stepInto"), !!paused)}
        {tool("Step out", "Shift+F11", StepOutIcon, () => act("stepOut"), !!paused)}
        {tool("Stop", "Shift+F5", StopIcon, () => act("stop"), !finished)}
      </div>
      <Button
        size="small"
        type="text"
        className="kx:ml-auto"
        disabled={!finished}
        onClick={() => dispatch(debugSessionClosed())}
      >
        Close
      </Button>
    </div>
  );
}

function Hint({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Typography.Text type="secondary" className="kx:block kx:p-2 kx:text-xs">
      {children}
    </Typography.Text>
  );
}

function Variables({
  run,
  frame,
}: Readonly<{ run: AgentRunState | undefined; frame: DebugCallFrameDto | undefined }>) {
  const roots = useMemo<ValueRoot[]>(
    () =>
      (frame?.scopes ?? []).map((scope, index) => ({
        key: `${index}:${scope.type}`,
        name: scope.name,
        ref: scope.ref,
      })),
    [frame],
  );
  if (!run) return <Hint>Not debugging.</Hint>;
  if (!run.paused)
    return <Hint>{isFinished(run.status) ? "The run has ended." : "Not paused."}</Hint>;
  if (!frame?.id)
    return <Hint>This caller ran before an await; its variables are no longer available.</Hint>;
  const local = roots.find((root) => root.key.endsWith(":local"))?.key;
  return (
    <ValueTree
      key={`${run.paused.seq}:${frame.id}`}
      ariaLabel="Variables"
      runId={run.id}
      pause={run.paused.seq}
      roots={roots}
      defaultExpanded={local ? [local] : roots.slice(0, 1).map((root) => root.key)}
    />
  );
}

/** Evaluates `expressions` in the frame at every pause; re-runs when either changes. */
function useEvaluations(
  run: AgentRunState | undefined,
  frame: DebugCallFrameDto | undefined,
  expressions: readonly string[],
) {
  const [evaluate] = useEvaluateMutation();
  // Values belong to the pause and frame they were evaluated in.
  const [evaluated, setEvaluated] = useState<{
    key: string;
    values: ReadonlyMap<string, DebugValueDto>;
  }>({ key: "", values: new Map() });
  const frameId = frame?.id ?? null;
  const key = run?.paused && frameId ? `${run.paused.seq}:${frameId}` : "";
  useEffect(() => {
    if (!run || !key || !frameId) return;
    let current = true;
    void Promise.all(
      expressions.map(async (expression) => {
        try {
          return [
            expression,
            await evaluate({ runId: run.id, expression, frameId }).unwrap(),
          ] as const;
        } catch (failure) {
          return [expression, { type: "error", value: errorMessage(failure), ref: null }] as const;
        }
      }),
    ).then((entries) => current && setEvaluated({ key, values: new Map(entries) }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, key, expressions]);
  return key && evaluated.key === key ? evaluated.values : NO_VALUES;
}

function Watch({
  run,
  frame,
}: Readonly<{ run: AgentRunState | undefined; frame: DebugCallFrameDto | undefined }>) {
  const dispatch = useAppDispatch();
  const watches = useAppSelector(selectWatches);
  const values = useEvaluations(run, frame, watches);
  const [draft, setDraft] = useState("");
  const roots = useMemo<ValueRoot[]>(
    () =>
      watches.map((expression) => {
        const value = values.get(expression);
        return {
          key: `watch:${expression}`,
          name: expression,
          value: value ?? {
            type: "undefined",
            value: run?.paused ? "…" : "not available",
            ref: null,
          },
          ref: value?.ref ?? null,
          extra: (
            <Button
              type="text"
              size="small"
              className="kx:ml-1"
              onClick={(event) => {
                event.stopPropagation();
                dispatch(watchRemoved(expression));
              }}
              icon={<AppIcon icon={RemoveIcon} size="sm" label={`Remove watch ${expression}`} />}
            />
          ),
        };
      }),
    [watches, values, run?.paused, dispatch],
  );
  return (
    <div className="kx:flex kx:flex-col kx:gap-1">
      <ValueTree
        key={`${run?.paused?.seq ?? 0}:${frame?.id ?? ""}:${values.size}`}
        ariaLabel="Watch expressions"
        runId={run?.id ?? ""}
        pause={run?.paused?.seq ?? 0}
        roots={roots}
      />
      <Input
        size="small"
        aria-label="Add watch expression"
        placeholder="Add expression"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPressEnter={() => {
          if (draft.trim()) dispatch(watchAdded(draft.trim()));
          setDraft("");
        }}
      />
    </div>
  );
}

function CallStack({
  frames,
  selected,
  onSelect,
}: Readonly<{
  frames: readonly DebugCallFrameDto[];
  selected: number;
  onSelect: (index: number, frame: DebugCallFrameDto) => void;
}>) {
  if (frames.length === 0) return <Hint>Not paused.</Hint>;
  return (
    <ul aria-label="Call stack" className="kx:m-0 kx:list-none kx:p-0">
      {frames.map((frame, index) => (
        <li key={index}>
          {frame.asyncBoundary && (
            <div className="kx:px-2 kx:py-0.5 kx:text-center kx:text-xs kx:text-text-muted">
              ── {frame.asyncBoundary} ──
            </div>
          )}
          <button
            type="button"
            aria-current={index === selected && !!frame.id}
            onClick={() => onSelect(index, frame)}
            className={`kx:flex kx:w-full kx:cursor-pointer kx:items-center kx:justify-between kx:gap-2 kx:rounded kx:border-0 kx:px-2 kx:py-0.5 kx:text-left kx:font-mono kx:text-xs ${
              index === selected && frame.id ? "kx:bg-fill" : "kx:bg-transparent"
            } ${frame.location.file ? "kx:text-text" : "kx:text-text-muted"}`}
          >
            <span className="kx:truncate">{frame.name}</span>
            <span className="kx:shrink-0 kx:text-text-muted">{locationLabel(frame.location)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type ConsoleEntry = Readonly<{
  id: number;
  expression: string;
  value: DebugValueDto;
  pause: number;
}>;

/** Evaluates expressions in the selected frame, or in the agent process while it runs. */
export function DebugConsole({
  run,
  frame,
}: Readonly<{ run: AgentRunState; frame: DebugCallFrameDto | undefined }>) {
  const [evaluate, evaluating] = useEvaluateMutation();
  const [entries, setEntries] = useState<readonly ConsoleEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<{ items: readonly string[]; at: number }>({
    items: [],
    at: 0,
  });
  const finished = isFinished(run.status);
  const submit = async () => {
    const expression = draft.trim();
    if (!expression || finished) return;
    setDraft("");
    setHistory((current) => ({
      items: [...current.items, expression],
      at: current.items.length + 1,
    }));
    let value: DebugValueDto;
    try {
      value = await evaluate({ runId: run.id, expression, frameId: frame?.id ?? null }).unwrap();
    } catch (failure) {
      value = { type: "error", value: errorMessage(failure), ref: null };
    }
    setEntries((current) => [
      ...current.slice(-199),
      { id: (current.at(-1)?.id ?? 0) + 1, expression, value, pause: run.paused?.seq ?? 0 },
    ]);
  };
  return (
    <section aria-label="Debug console" className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <div className={`kx:flex kx:h-8 kx:shrink-0 kx:items-center kx:px-3 ${borderB}`}>
        <Typography.Text type="secondary" strong className="kx:text-xs kx:uppercase">
          Debug console
        </Typography.Text>
      </div>
      <div aria-label="Debug console output" className="kx:min-h-0 kx:flex-1 kx:overflow-auto">
        {entries.length === 0 && (
          <Hint>
            Evaluate expressions {run.paused ? "in the selected frame" : "in the agent process"}.
          </Hint>
        )}
        {entries.map((entry) =>
          // Objects can be expanded only during the pause that produced them.
          entry.value.ref && entry.pause === (run.paused?.seq ?? -1) ? (
            <ValueTree
              key={entry.id}
              ariaLabel={`Result of ${entry.expression}`}
              runId={run.id}
              pause={entry.pause}
              roots={[
                {
                  key: `console:${entry.id}`,
                  name: `› ${entry.expression}`,
                  value: entry.value,
                  ref: entry.value.ref,
                },
              ]}
            />
          ) : (
            <div key={entry.id} className="kx:flex kx:flex-col kx:px-2 kx:py-0.5">
              <ValueLabel name={`› ${entry.expression}`} />
              <span className="kx:pl-3">
                <ValueLabel name="" value={entry.value} />
              </span>
            </div>
          ),
        )}
      </div>
      <Input
        size="small"
        aria-label="Evaluate expression"
        placeholder={finished ? "The run has ended" : "Evaluate (↑ for history)"}
        disabled={finished}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPressEnter={() => void submit()}
        suffix={evaluating.isLoading ? "…" : undefined}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const at = Math.min(
            history.items.length,
            Math.max(0, history.at + (event.key === "ArrowUp" ? -1 : 1)),
          );
          setHistory({ ...history, at });
          setDraft(history.items[at] ?? "");
        }}
      />
    </section>
  );
}
