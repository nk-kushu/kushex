import { createSlice, type Draft, type PayloadAction } from "@reduxjs/toolkit";
import type {
  AgentRunDto,
  AgentRunEventDto,
  AgentRunStatus,
  DebugBreakpointDto,
  DebugCallFrameDto,
} from "@kushex/contracts";
import { safeStorage } from "../../shared/lib/storage";
import type { AppDispatch, RootState } from "../../app/store";
import type { StoreOptions } from "../../app/storeOptions";

export type ChatEntry =
  | Readonly<{ id: string; kind: "user"; text: string; files: readonly string[]; debug: boolean }>
  | Readonly<{ id: string; kind: "run"; runId: string }>
  /** The run could not start, e.g. a debug session is already running. */
  | Readonly<{ id: string; kind: "failure"; text: string }>;

export type PausedState = Readonly<{
  reason: string;
  frames: readonly DebugCallFrameDto[];
  /** Counts pauses, so values fetched during an earlier pause are never reused. */
  seq: number;
}>;

export type AgentRunState = {
  id: string;
  startedAt: string;
  projectId: string;
  agentName: string;
  debug: boolean;
  status: AgentRunStatus;
  progress: string[];
  /** stdout and stderr together, most recent part only. */
  output: string;
  result: { value: unknown; truncated: boolean } | null;
  error: { message: string; stack: string | null } | null;
  paused: PausedState | null;
  pauses: number;
  /** Where the debugger bound the agent's breakpoints. */
  breakpoints: readonly DebugBreakpointDto[];
};

/** Agent → agent-relative file → 1-based lines. */
export type Breakpoints = Record<string, Record<string, number[]>>;

type RunsState = {
  /** Per project: the agent picked in the chat and the conversation. */
  chats: Record<
    string,
    { agentName: string | null; debugging: boolean; entries: ChatEntry[]; threadId: string | null }
  >;
  runs: Record<string, AgentRunState>;
  /** The debug run the agent editor shows; kept after it ends until the next one. */
  debugRunId: string | null;
  selectedFrame: number;
  breakpoints: Breakpoints;
  watches: string[];
};

const MAX_OUTPUT_CHARS = 200_000;
const TERMINAL: ReadonlySet<AgentRunStatus> = new Set(["completed", "failed", "cancelled"]);
export const isFinished = (status: AgentRunStatus) => TERMINAL.has(status);

/** Breakpoints, watches and the chosen agents outlive a reload, per panel instance. */
const storageKey = (instanceId = "default") => `kushex:${instanceId}:runs`;
type Persisted = Pick<RunsState, "breakpoints" | "watches"> & {
  agents: Record<string, string | null>;
  debugging?: Record<string, boolean>;
};

export function restoreRuns(instanceId?: string): RunsState {
  const state = initialState();
  try {
    const saved = JSON.parse(
      safeStorage.read(storageKey(instanceId)) ?? "null",
    ) as Persisted | null;
    if (!saved) return state;
    state.breakpoints = saved.breakpoints ?? {};
    state.watches = saved.watches ?? [];
    for (const [projectId, agentName] of Object.entries(saved.agents ?? {}))
      state.chats[projectId] = {
        agentName,
        debugging: saved.debugging?.[projectId] ?? false,
        entries: [],
        threadId: null,
      };
  } catch {
    // Corrupt preferences start over.
  }
  return state;
}

export function persistRuns(state: RunsState, instanceId?: string): void {
  const persisted: Persisted = {
    breakpoints: state.breakpoints,
    watches: state.watches,
    agents: Object.fromEntries(
      Object.entries(state.chats).map(([projectId, chat]) => [projectId, chat.agentName]),
    ),
    debugging: Object.fromEntries(
      Object.entries(state.chats).map(([id, chat]) => [id, chat.debugging]),
    ),
  };
  safeStorage.write(storageKey(instanceId), JSON.stringify(persisted));
}

function initialState(): RunsState {
  return {
    chats: {},
    runs: {},
    debugRunId: null,
    selectedFrame: 0,
    breakpoints: {},
    watches: [],
  };
}

/** Read before sending: a background tab may not have received another tab's update yet. */
export const refreshBreakpointPreferences =
  () => (dispatch: AppDispatch, getState: () => RootState, options: StoreOptions) => {
    if (safeStorage.read(storageKey(options.instanceId)) !== null)
      dispatch(breakpointsSynchronized(restoreRuns(options.instanceId).breakpoints));
    return getState().runs.breakpoints;
  };

let nextEntryId = 0;
const entryId = () => `entry-${++nextEntryId}`;
const chatOf = (state: RunsState, projectId: string) =>
  (state.chats[projectId] ??= { agentName: null, debugging: false, entries: [], threadId: null });

export const runsSlice = createSlice({
  name: "runs",
  initialState,
  reducers: {
    /** Another tab's preferences; local chat history and execution state stay intact. */
    breakpointsSynchronized(state, action: PayloadAction<Breakpoints>) {
      state.breakpoints = action.payload;
    },
    chatAgentSelected(state, action: PayloadAction<{ projectId: string; agentName: string }>) {
      chatOf(state, action.payload.projectId).agentName = action.payload.agentName;
    },
    chatCleared(state, action: PayloadAction<string>) {
      chatOf(state, action.payload).entries = [];
      chatOf(state, action.payload).threadId = null;
    },
    threadSelected(state, action: PayloadAction<{ projectId: string; threadId: string }>) {
      const chat = chatOf(state, action.payload.projectId);
      chat.threadId = action.payload.threadId;
      chat.entries = [];
    },
    restoredTurn(
      state,
      action: PayloadAction<{
        projectId: string;
        run: AgentRunDto;
        text: string;
        files: readonly string[];
      }>,
    ) {
      const { projectId, run, text, files } = action.payload;
      chatOf(state, projectId).agentName = run.agentName;
      chatOf(state, projectId).entries.push({
        id: entryId(),
        kind: "user",
        text,
        files,
        debug: run.debug,
      });
      state.runs[run.id] = {
        ...run,
        progress: [],
        output: "",
        result: null,
        error: null,
        paused: null,
        pauses: 0,
        breakpoints: [],
      };
      chatOf(state, projectId).entries.push({ id: entryId(), kind: "run", runId: run.id });
    },
    chatDebuggingChanged(state, action: PayloadAction<{ projectId: string; enabled: boolean }>) {
      chatOf(state, action.payload.projectId).debugging = action.payload.enabled;
    },
    messageSent: {
      reducer(
        state,
        action: PayloadAction<{
          projectId: string;
          id: string;
          text: string;
          files: readonly string[];
          debug: boolean;
        }>,
      ) {
        const { projectId, ...entry } = action.payload;
        chatOf(state, projectId).entries.push({ ...entry, kind: "user" });
      },
      prepare(payload: {
        projectId: string;
        text: string;
        files: readonly string[];
        debug: boolean;
      }) {
        return { payload: { ...payload, id: entryId() } };
      },
    },
    runStartFailed(state, action: PayloadAction<{ projectId: string; text: string }>) {
      chatOf(state, action.payload.projectId).entries.push({
        id: entryId(),
        kind: "failure",
        text: action.payload.text,
      });
    },
    runStarted(state, action: PayloadAction<AgentRunDto>) {
      const run = action.payload;
      state.runs[run.id] = {
        id: run.id,
        startedAt: run.startedAt,
        projectId: run.projectId,
        agentName: run.agentName,
        debug: run.debug,
        status: run.status,
        progress: [],
        output: "",
        result: null,
        error: null,
        paused: null,
        pauses: 0,
        breakpoints: [],
      };
      chatOf(state, run.projectId).entries.push({ id: entryId(), kind: "run", runId: run.id });
      if (run.debug) {
        state.debugRunId = run.id;
        state.selectedFrame = 0;
      }
    },
    runEventReceived(state, action: PayloadAction<{ runId: string; event: AgentRunEventDto }>) {
      const run = state.runs[action.payload.runId];
      const event = action.payload.event;
      if (!run) return;
      switch (event.type) {
        case "status":
          run.status = event.status;
          if (isFinished(event.status)) run.paused = null;
          break;
        case "progress":
          run.progress.push(event.message);
          break;
        case "output":
          run.output = (run.output + event.text).slice(-MAX_OUTPUT_CHARS);
          break;
        case "result":
          run.result = { value: event.value, truncated: event.truncated };
          break;
        case "error":
          run.error = { message: event.message, stack: event.stack };
          break;
        case "paused":
          run.pauses += 1;
          // Immer drafts are mutable, but events are stored as received.
          run.paused = {
            reason: event.reason,
            frames: event.frames,
            seq: run.pauses,
          } as Draft<PausedState>;
          if (state.debugRunId === run.id) state.selectedFrame = 0;
          break;
        case "resumed":
          run.paused = null;
          break;
        case "breakpoints":
          run.breakpoints = event.breakpoints as Draft<readonly DebugBreakpointDto[]>;
          break;
      }
    },
    /** Lost the event stream for good; the run's state is no longer known. */
    runStreamFailed(state, action: PayloadAction<string>) {
      const run = state.runs[action.payload];
      if (!run || isFinished(run.status)) return;
      run.status = "failed";
      run.paused = null;
      run.error ??= { message: "Lost the connection to this run.", stack: null };
    },
    debugSessionClosed(state) {
      state.debugRunId = null;
    },
    frameSelected(state, action: PayloadAction<number>) {
      state.selectedFrame = action.payload;
    },
    breakpointToggled(
      state,
      action: PayloadAction<{ agentName: string; file: string; line: number }>,
    ) {
      const { agentName, file, line } = action.payload;
      const files = (state.breakpoints[agentName] ??= {});
      const lines = files[file] ?? [];
      files[file] = lines.includes(line)
        ? lines.filter((existing) => existing !== line)
        : [...lines, line].sort((a, b) => a - b);
      if (files[file].length === 0) delete files[file];
    },
    /** Replaces one file's lines, e.g. after edits moved them. */
    breakpointsMoved(
      state,
      action: PayloadAction<{ agentName: string; file: string; lines: number[] }>,
    ) {
      const { agentName, file, lines } = action.payload;
      const files = (state.breakpoints[agentName] ??= {});
      if (lines.length) files[file] = [...new Set(lines)].sort((a, b) => a - b);
      else delete files[file];
    },
    breakpointsCleared(state, action: PayloadAction<string>) {
      delete state.breakpoints[action.payload];
    },
    watchAdded(state, action: PayloadAction<string>) {
      if (!state.watches.includes(action.payload)) state.watches.push(action.payload);
    },
    watchRemoved(state, action: PayloadAction<string>) {
      state.watches = state.watches.filter((watch) => watch !== action.payload);
    },
  },
  selectors: {
    selectChat: (state, projectId: string | null) =>
      (projectId ? state.chats[projectId] : undefined) ?? EMPTY_CHAT,
    selectRun: (state, runId: string) => state.runs[runId],
    selectDebugRun: (state) => (state.debugRunId ? state.runs[state.debugRunId] : undefined),
    selectSelectedFrame: (state) => state.selectedFrame,
    selectAgentBreakpoints: (state, agentName: string) =>
      state.breakpoints[agentName] ?? EMPTY_BREAKPOINTS,
    selectWatches: (state) => state.watches,
  },
});

const EMPTY_CHAT = {
  agentName: null,
  debugging: false,
  entries: [] as ChatEntry[],
  threadId: null,
};
const EMPTY_BREAKPOINTS: Record<string, number[]> = {};

export const {
  chatAgentSelected,
  chatCleared,
  threadSelected,
  restoredTurn,
  chatDebuggingChanged,
  messageSent,
  runStartFailed,
  runStarted,
  runEventReceived,
  runStreamFailed,
  debugSessionClosed,
  frameSelected,
  breakpointToggled,
  breakpointsMoved,
  breakpointsCleared,
  breakpointsSynchronized,
  watchAdded,
  watchRemoved,
} = runsSlice.actions;
export const {
  selectChat,
  selectRun,
  selectDebugRun,
  selectSelectedFrame,
  selectAgentBreakpoints,
  selectWatches,
} = runsSlice.selectors;
