import { Alert, Button, Collapse, Empty, Input, Select, Tag, Tooltip } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AgentRunStatus } from "@kushex/contracts";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useAgentsQuery,
  useCancelAgentRunMutation,
  useDebugCommandMutation,
  useStartAgentRunMutation,
  useChatThreadsQuery,
  useLazyChatThreadQuery,
  useCreateChatThreadMutation,
  kushexApi,
} from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import {
  AgentsIcon,
  AttachIcon,
  ChatStartIcon,
  ContinueIcon,
  DebugEventsIcon,
  DebugIcon,
  FileIcon,
  NewChatIcon,
  SendIcon,
  StopIcon,
} from "../../shared/lib/icons";
import { borderAll } from "../../shared/lib/styles";
import {
  chatAgentSelected,
  chatCleared,
  chatDebuggingChanged,
  isFinished,
  messageSent,
  runStartFailed,
  runStreamFailed,
  runStarted,
  runEventReceived,
  threadSelected,
  restoredTurn,
  refreshBreakpointPreferences,
  selectChat,
  selectRun,
  selectDebugRun,
  type ChatEntry,
} from "../runs/runsSlice";
import { frameLabel } from "../runs/frameLabel";
import { paths } from "../workbench/navigation";
import { PaneHeader } from "../workbench/PaneHeader";
import { selectProjectId } from "../workbench/workbenchSlice";
import { AttachFilesDialog } from "./AttachFilesDialog";

/** The agent's task contract allows at most this many files. */
const MAX_FILES = 16;

/** Chat with an agent from `agents/` about the open project; each message is one run. */
export function ChatPanel() {
  const projectId = useAppSelector(selectProjectId);
  return (
    <aside aria-label="Chat" className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      {projectId ? (
        <ProjectChat key={projectId} projectId={projectId} />
      ) : (
        <>
          <PaneHeader title="Chat" />
          <Empty className="kx:mt-8" description="Open a project to chat with its agents." />
        </>
      )}
    </aside>
  );
}

function ProjectChat({ projectId }: Readonly<{ projectId: string }>) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const agents = useAgentsQuery();
  const threads = useChatThreadsQuery(projectId);
  const [loadThread, loadingThread] = useLazyChatThreadQuery();
  const [createThread, creatingThread] = useCreateChatThreadMutation();
  const [threadError, setThreadError] = useState<string | null>(null);
  const chat = useAppSelector((state) => selectChat(state, projectId));
  const [text, setText] = useState("");
  const [files, setFiles] = useState<readonly string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [start, starting] = useStartAgentRunMutation();
  const [cancelDebug, stoppingDebug] = useCancelAgentRunMutation();
  const debugRun = useAppSelector(selectDebugRun);
  const activeDebug =
    debugRun?.projectId === projectId && !isFinished(debugRun.status) ? debugRun : null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const agentName = chat.agentName;
  const known = !!agentName && !!agents.data?.entries.some((agent) => agent.name === agentName);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.entries.length]);

  const send = async (debug = chat.debugging) => {
    const message = text.trim();
    if (!message || !agentName || starting.isLoading || activeDebug || stoppingDebug.isLoading)
      return;
    // Read shared preferences before messageSent persists this tab's chat state.
    const breakpoints = debug ? (dispatch(refreshBreakpointPreferences())[agentName] ?? {}) : {};
    try {
      const threadId = chat.threadId ?? (await createThread(projectId).unwrap()).id;
      if (!chat.threadId) dispatch(threadSelected({ projectId, threadId }));
      dispatch(messageSent({ projectId, text: message, files, debug }));
      setText("");
      const run = await start({
        projectId,
        threadId,
        agentName,
        message,
        files,
        debug,
        ...(debug ? { breakpoints } : {}),
      }).unwrap();
      dispatch(runStarted(run));
      dispatch(kushexApi.util.invalidateTags(["ChatThreads"]));
    } catch (failure) {
      dispatch(runStartFailed({ projectId, text: errorMessage(failure) }));
    }
  };

  const selectThread = async (id: string) => {
    setThreadError(null);
    try {
      const thread = await loadThread({ projectId, id }, false).unwrap();
      dispatch(threadSelected({ projectId, threadId: id }));
      for (const turn of thread.turns) {
        dispatch(
          restoredTurn({
            projectId,
            text: turn.message,
            files: turn.files,
            run: {
              id: turn.id,
              projectId,
              agentName: turn.agentName,
              debug: turn.debug,
              status: "starting",
              startedAt: turn.createdAt,
            },
          }),
        );
        for (const event of turn.events) dispatch(runEventReceived({ runId: turn.id, event }));
        if (!turn.events.some((event) => event.type === "status" && isFinished(event.status)))
          dispatch(runStreamFailed(turn.id));
      }
    } catch (failure) {
      setThreadError(errorMessage(failure));
    }
  };

  const toggleDebugging = async () => {
    stoppingDebug.reset();
    dispatch(refreshBreakpointPreferences());
    const enabled = !(chat.debugging || activeDebug);
    dispatch(chatDebuggingChanged({ projectId, enabled }));
    if (!enabled && activeDebug) {
      try {
        await cancelDebug(activeDebug.id).unwrap();
      } catch {
        /* The mutation error is shown below the composer. */
      }
    }
  };

  const debugging = Boolean(chat.debugging || activeDebug);
  const canSend =
    !!text.trim() &&
    !!agentName &&
    !activeDebug &&
    !stoppingDebug.isLoading &&
    !starting.isLoading &&
    !creatingThread.isLoading &&
    !loadingThread.isFetching;

  return (
    <>
      <PaneHeader
        title="Chat"
        extra={
          <Tooltip title="New chat">
            <Button
              type="text"
              size="small"
              disabled={chat.entries.length === 0}
              onClick={() => dispatch(chatCleared(projectId))}
              icon={<AppIcon icon={NewChatIcon} label="New chat" />}
            />
          </Tooltip>
        }
      />
      <div className="kx:flex kx:gap-2 kx:px-3 kx:pt-2">
        <Select
          aria-label="Chat thread"
          className="kx:min-w-0 kx:flex-1"
          placeholder="New chat"
          value={chat.threadId ?? undefined}
          loading={threads.isLoading || loadingThread.isFetching}
          disabled={starting.isLoading || creatingThread.isLoading}
          onChange={(id: string) => void selectThread(id)}
          options={threads.data?.map((thread) => ({ value: thread.id, label: thread.title }))}
        />
        <Button onClick={() => void navigate(paths.chatThreads(projectId))}>All threads</Button>
      </div>
      {(threadError || threads.error) && (
        <Alert type="error" showIcon title={threadError ?? errorMessage(threads.error)} />
      )}
      <div className="kx:flex kx:min-h-0 kx:flex-1 kx:flex-col kx:gap-5 kx:overflow-auto kx:px-4 kx:py-4">
        {chat.entries.length === 0 && <EmptyChat agentName={agentName} />}
        {chat.entries.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="kx:shrink-0 kx:px-3 kx:pt-1 kx:pb-3">
        {debugging && (
          <div className="kx:mb-2 kx:flex kx:items-center kx:gap-1.5 kx:rounded-lg kx:bg-error/10 kx:px-2.5 kx:py-1.5 kx:text-xs kx:text-error">
            <AppIcon icon={DebugIcon} size="sm" />
            <span>Debugging enabled · each message runs with your breakpoints.</span>
          </div>
        )}
        <div
          className={`kx-composer kx:flex kx:flex-col kx:rounded-2xl kx:bg-surface kx:shadow-sm kx:transition-shadow kx:focus-within:shadow-md kx:focus-within:ring-2 kx:focus-within:ring-primary/20 ${borderAll} kx:focus-within:border-primary`}
        >
          {files.length > 0 && (
            <div
              className="kx:flex kx:flex-wrap kx:gap-1.5 kx:px-3 kx:pt-3"
              aria-label="Attached files"
            >
              {files.map((file) => (
                <Tag
                  key={file}
                  closable
                  bordered={false}
                  className="kx:m-0 kx:inline-flex kx:items-center kx:gap-1 kx:rounded-full kx:px-2 kx:py-0.5"
                  onClose={() => setFiles((all) => all.filter((entry) => entry !== file))}
                >
                  <AppIcon icon={FileIcon} size="sm" />
                  {file}
                </Tag>
              ))}
            </div>
          )}
          <Input.TextArea
            aria-label="Message"
            variant="borderless"
            placeholder={agentName ? `Message ${agentName}…` : "Choose an agent first"}
            autoSize={{ minRows: 1, maxRows: 8 }}
            maxLength={8000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter adds a line; Ctrl/⌘+Shift+Enter sends with debugging.
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              const modifier = event.metaKey || event.ctrlKey;
              if (event.shiftKey && !modifier) return;
              event.preventDefault();
              const debugNow = modifier && event.shiftKey;
              if (debugNow && !activeDebug) {
                dispatch(refreshBreakpointPreferences());
                dispatch(chatDebuggingChanged({ projectId, enabled: true }));
              }
              void send(debugNow || chat.debugging);
            }}
          />
          <div className="kx:flex kx:items-center kx:gap-1 kx:px-2 kx:pt-1 kx:pb-2">
            <Tooltip title="Attach files">
              <Button
                type="text"
                size="small"
                shape="circle"
                onClick={() => setAttaching(true)}
                icon={<AppIcon icon={AttachIcon} label="Attach files" />}
              />
            </Tooltip>
            <Select
              aria-label="Agent"
              size="small"
              variant="filled"
              popupMatchSelectWidth={false}
              placement="topLeft"
              className="kx:max-w-40 kx:min-w-28"
              placeholder="Choose an agent"
              loading={agents.isLoading}
              value={agentName ?? undefined}
              status={agentName && agents.data && !known ? "warning" : undefined}
              onChange={(name: string) =>
                dispatch(chatAgentSelected({ projectId, agentName: name }))
              }
              options={agents.data?.entries.map((agent) => ({
                value: agent.name,
                label: agent.name,
              }))}
            />
            <Tooltip
              title={
                debugging
                  ? "Stop debugging and cancel the current debug run"
                  : "Debug every message using your Agents breakpoints"
              }
            >
              <Button
                size="small"
                shape="circle"
                type={debugging ? "primary" : "text"}
                className="kx:ml-auto"
                aria-label={debugging ? "Stop debugging" : "Start debugging"}
                aria-pressed={debugging}
                danger={debugging}
                disabled={!agentName || starting.isLoading}
                loading={stoppingDebug.isLoading}
                onClick={() => void toggleDebugging()}
                icon={<AppIcon icon={debugging ? StopIcon : DebugIcon} />}
              />
            </Tooltip>
            <Tooltip
              title={
                activeDebug
                  ? "Finish or stop the current debug run before sending another message"
                  : "Send (Enter)"
              }
            >
              <Button
                type="primary"
                shape="circle"
                aria-label="Send"
                disabled={!canSend && !starting.isLoading}
                loading={starting.isLoading}
                onClick={() => void send()}
                icon={<AppIcon icon={SendIcon} />}
              />
            </Tooltip>
          </div>
        </div>
        <div className="kx:mt-1.5 kx:px-1 kx:text-center kx:text-[11px] kx:text-text-muted">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
        </div>
        {stoppingDebug.error && (
          <Alert
            className="kx:mt-2"
            type="error"
            showIcon
            title={errorMessage(stoppingDebug.error)}
          />
        )}
      </div>
      {attaching && (
        <AttachFilesDialog
          projectId={projectId}
          initial={files}
          max={MAX_FILES}
          onClose={() => setAttaching(false)}
          onAttach={(selected) => {
            setFiles(selected);
            setAttaching(false);
          }}
        />
      )}
    </>
  );
}

function Kbd({ children }: Readonly<{ children: string }>) {
  return (
    <kbd className="kx:rounded kx:bg-fill kx:px-1 kx:py-px kx:font-sans kx:text-[10px]">
      {children}
    </kbd>
  );
}

function EmptyChat({ agentName }: Readonly<{ agentName: string | null | undefined }>) {
  return (
    <div className="kx:m-auto kx:flex kx:max-w-72 kx:flex-col kx:items-center kx:gap-3 kx:text-center">
      <div className="kx:flex kx:size-12 kx:items-center kx:justify-center kx:rounded-2xl kx:bg-primary/10 kx:text-primary">
        <AppIcon icon={agentName ? AgentsIcon : ChatStartIcon} size="lg" />
      </div>
      <div className="kx:text-base kx:font-semibold kx:text-text">
        {agentName ? `Chat with ${agentName}` : "Start a conversation"}
      </div>
      <div className="kx:text-sm kx:leading-relaxed kx:text-text-muted">
        {agentName
          ? `Send a message to run ${agentName} on this project. Start debugging to use your Agents breakpoints for every message.`
          : "Choose an agent from your agents folder to try it on this project."}
      </div>
    </div>
  );
}

function Entry({ entry }: Readonly<{ entry: ChatEntry }>) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="kx:flex kx:justify-end kx:pl-8">
          <div className="kx:flex kx:max-w-full kx:flex-col kx:gap-1.5 kx:rounded-2xl kx:rounded-br-md kx:bg-primary kx:px-3.5 kx:py-2 kx:text-white kx:shadow-sm">
            <span className="kx:break-words kx:whitespace-pre-wrap">{entry.text}</span>
            {entry.files.length > 0 && (
              <div className="kx:flex kx:flex-wrap kx:gap-1">
                {entry.files.map((file) => (
                  <span
                    key={file}
                    className="kx:inline-flex kx:items-center kx:gap-1 kx:rounded-full kx:bg-white/20 kx:px-2 kx:py-0.5 kx:text-xs"
                  >
                    <AppIcon icon={FileIcon} size="sm" />
                    {file}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    case "failure":
      return <Alert className="kx:rounded-xl" type="error" showIcon title={entry.text} />;
    case "run":
      return <RunMessage runId={entry.runId} />;
  }
}

const STATUS_DOTS: Record<AgentRunStatus, string> = {
  starting: "kx:bg-primary kx:animate-pulse",
  running: "kx:bg-primary kx:animate-pulse",
  paused: "kx:bg-warning",
  completed: "kx:bg-success",
  failed: "kx:bg-error",
  cancelled: "kx:bg-text-muted",
};

function StatusBadge({ status }: Readonly<{ status: AgentRunStatus }>) {
  return (
    <span className="kx:inline-flex kx:items-center kx:gap-1.5 kx:text-xs kx:text-text-muted">
      <span className={`kx:size-1.5 kx:rounded-full ${STATUS_DOTS[status]}`} />
      {status}
    </span>
  );
}

function TypingDots() {
  return (
    <div
      aria-label="Agent is working"
      className="kx:flex kx:w-fit kx:items-center kx:gap-1 kx:rounded-2xl kx:rounded-tl-md kx:bg-fill kx:px-3.5 kx:py-3"
    >
      <span className="kx-typing-dot kx:size-1.5 kx:rounded-full kx:bg-text-muted" />
      <span className="kx-typing-dot kx:size-1.5 kx:rounded-full kx:bg-text-muted" />
      <span className="kx-typing-dot kx:size-1.5 kx:rounded-full kx:bg-text-muted" />
    </div>
  );
}

/** Progress steps as a small timeline; open while the run works, folded once it ends. */
function Steps({ steps, active }: Readonly<{ steps: readonly string[]; active: boolean }>) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? active;
  const shown = steps.slice(-50);
  return (
    <div className="kx:flex kx:flex-col kx:gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="kx:inline-flex kx:w-fit kx:cursor-pointer kx:items-center kx:gap-1 kx:border-0 kx:bg-transparent kx:p-0 kx:text-xs kx:text-text-muted kx:hover:text-text"
      >
        <span
          className={`kx:inline-flex kx:transition-transform ${expanded ? "kx:rotate-90" : ""}`}
        >
          <AppIcon icon={IconChevronRight} size="sm" />
        </span>
        {steps.length} {steps.length === 1 ? "step" : "steps"}
      </button>
      <div hidden={!expanded}>
        <ol className="kx:m-0 kx:ml-1.5 kx:flex kx:list-none kx:flex-col kx:gap-1 kx:border-0 kx:border-l kx:border-solid kx:border-border kx:py-0.5 kx:pl-3">
          {shown.map((message, index) => (
            <li
              key={index}
              className={`kx:relative kx:text-xs kx:break-words ${
                active && index === shown.length - 1 ? "kx:text-text" : "kx:text-text-muted"
              }`}
            >
              <span
                className={`kx:absolute kx:top-1.5 kx:-left-[15.5px] kx:size-1.5 kx:rounded-full ${
                  active && index === shown.length - 1 ? "kx:bg-primary" : "kx:bg-border"
                }`}
              />
              {message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function RunMessage({ runId }: Readonly<{ runId: string }>) {
  const run = useAppSelector((state) => selectRun(state, runId));
  const navigate = useNavigate();
  const [cancel, cancelling] = useCancelAgentRunMutation();
  const [command] = useDebugCommandMutation();
  if (!run) return null;
  const active = !isFinished(run.status);
  const top = run.paused?.frames[0];
  return (
    <div aria-label={`${run.agentName} run`} className="kx:flex kx:gap-2.5 kx:pr-4">
      <div className="kx:flex kx:size-7 kx:shrink-0 kx:items-center kx:justify-center kx:rounded-full kx:bg-primary/10 kx:text-primary">
        <AppIcon icon={AgentsIcon} size="sm" />
      </div>
      <div className="kx:flex kx:min-w-0 kx:flex-1 kx:flex-col kx:gap-2 kx:text-text">
        <div className="kx:flex kx:min-h-7 kx:items-center kx:gap-2">
          <span className="kx:text-sm kx:font-semibold">{run.agentName}</span>
          {run.debug && (
            <Tag bordered={false} color="error" className="kx:m-0 kx:rounded-full kx:text-[10px]">
              debug
            </Tag>
          )}
          <StatusBadge status={run.status} />
          <Tooltip title="Debug events: kushibot's timeline of this run">
            <Button
              size="small"
              type="text"
              shape="circle"
              className="kx:ml-auto"
              onClick={() => void navigate(paths.runDebugEvents(run.projectId, run.id))}
              icon={<AppIcon icon={DebugEventsIcon} label="Debug events" />}
            />
          </Tooltip>
          {active && (
            <Tooltip title="Stop run">
              <Button
                size="small"
                type="text"
                shape="circle"
                loading={cancelling.isLoading}
                onClick={() => void cancel(run.id)}
                icon={<AppIcon icon={StopIcon} label="Stop run" />}
              />
            </Tooltip>
          )}
        </div>
        {run.progress.length > 0 && <Steps steps={run.progress} active={active} />}
        {active && !run.paused && !run.result && <TypingDots />}
        {run.paused && (
          <Alert
            className="kx:rounded-xl"
            type="warning"
            title={`Paused on ${run.paused.reason}${top ? ` at ${frameLabel(top)}` : ""}`}
            action={
              <div className="kx:flex kx:flex-col kx:gap-1">
                <Button size="small" onClick={() => void navigate(paths.agents(run.agentName))}>
                  Open debugger
                </Button>
                <Button
                  size="small"
                  onClick={() => void command({ runId: run.id, command: "continue" })}
                  icon={<AppIcon icon={ContinueIcon} />}
                >
                  Continue
                </Button>
              </div>
            }
          />
        )}
        {run.result && <ResultView value={run.result.value} truncated={run.result.truncated} />}
        {run.error && (
          <Alert
            className="kx:rounded-xl"
            type="error"
            showIcon
            title={run.error.message}
            description={
              run.error.stack ? (
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: "stack",
                      label: "Stack trace",
                      children: (
                        <pre className="kx:m-0 kx:overflow-auto kx:text-xs">{run.error.stack}</pre>
                      ),
                    },
                  ]}
                />
              ) : undefined
            }
          />
        )}
        {run.output && (
          <Collapse
            size="small"
            className="kx:overflow-hidden kx:rounded-xl"
            items={[
              {
                key: "output",
                label: "Output",
                children: (
                  <pre className="kx:m-0 kx:max-h-64 kx:overflow-auto kx:font-mono kx:text-xs">
                    {run.output}
                  </pre>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** Text answers read as text; anything else is shown as JSON. */
function ResultView({ value, truncated }: Readonly<{ value: unknown; truncated: boolean }>) {
  if (typeof value === "string" && !truncated)
    return (
      <div className="kx:w-fit kx:max-w-full kx:rounded-2xl kx:rounded-tl-md kx:bg-fill kx:px-3.5 kx:py-2.5 kx:leading-relaxed kx:break-words kx:whitespace-pre-wrap">
        {value}
      </div>
    );
  const json = truncated ? String(value) : JSON.stringify(value, null, 2);
  return (
    <Collapse
      size="small"
      className="kx:overflow-hidden kx:rounded-xl"
      defaultActiveKey={json.length < 2000 ? ["result"] : []}
      items={[
        {
          key: "result",
          label: truncated ? "Result (cut: too large to show in full)" : "Result",
          children: (
            <pre className="kx:m-0 kx:max-h-96 kx:overflow-auto kx:font-mono kx:text-xs">
              {json}
            </pre>
          ),
        },
      ]}
    />
  );
}
