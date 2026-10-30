/** Browser-safe JSON contracts. Filesystem contents are live read projections. */
export type WorkspaceDto = Readonly<{
  id: string;
  path: string;
  branch: string | null;
  revision: string | null;
}>;
export type ProjectDto = Readonly<{
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  workspace: WorkspaceDto;
}>;
export type CreateProjectRequest = Readonly<{ name: string; path: string; description?: string }>;
export type Page<T> = Readonly<{ entries: readonly T[]; nextOffset: number | null }>;
export type DirectoryEntryDto = Readonly<{
  name: string;
  path: string;
  kind: "directory" | "file";
}>;
export type DirectoryPageDto = Page<DirectoryEntryDto>;
export type FileContentDto = Readonly<{ path: string; size: number }> &
  (Readonly<{ kind: "text"; content: string }> | Readonly<{ kind: "binary" }>);
export type ApiErrorDto = Readonly<{ code: string; message: string; details?: readonly unknown[] }>;

/** Splitter id → each panel's share of the splitter (0–1, summing to 1). */
export type SplitterSizesDto = Readonly<Record<string, readonly number[]>>;

export type UserSettingsDto = Readonly<{
  colorMode: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  /** Pixels, for every Monaco editor in the panel. */
  editorFontSize: number;
  /** Pixels, for the code notes of the agent editor. */
  noteFontSize: number;
  splitterSizes: SplitterSizesDto;
}>;
/** `splitterSizes` merges by splitter id: ids left out keep their saved sizes. */
export type UpdateUserSettingsRequest = Partial<UserSettingsDto>;

/** An agent is a folder `agents/<name>/` whose primary file `agent.ts` exports a kushibot-based agent. */
export type PluginAgentContribution = Readonly<{
  id: string;
  name: string;
  description?: string;
  directory: string;
  entry: string;
}>;
export type PluginManifest = Readonly<{
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  agents: readonly PluginAgentContribution[];
}>;
export type AgentPluginMetadata = Readonly<{
  displayName?: string;
  description?: string;
  plugin?: Readonly<{ id: string; name: string }>;
}>;
export type PluginDto = Readonly<{
  id: string;
  name: string;
  version: string;
  agents: readonly PluginAgentContribution[];
  errors: readonly string[];
}>;
export type AgentSummaryDto = Readonly<{ name: string; updatedAt: string }> & AgentPluginMetadata;
/**
 * One file in an agent folder; `path` is relative to the folder, e.g. `prompts/review.md`.
 * Only text files within the size limit carry content and can be edited.
 */
export type AgentFileDto = Readonly<{ path: string; size: number; updatedAt: string }> &
  (
    | Readonly<{
        kind: "text";
        content: string;
        /** Content hash; a save must name the revision it was based on. */
        revision: string;
      }>
    | Readonly<{ kind: "binary" | "too-large" }>
  );
export type AgentDto = Readonly<{
  name: string;
  /** Path of the file that exports the agent, relative to the folder. */
  primaryFile: string;
  updatedAt: string;
  files: readonly AgentFileDto[];
  /** Every folder below the agent folder, including empty ones; paths use `/`. */
  folders: readonly string[];
}> &
  AgentPluginMetadata;
/** Folder-relative path; segments use letters, digits, `.`, `_` and `-` and cannot start with a dot. */
export type CreateAgentFileRequest = Readonly<{ path: string }>;
export type UpdateAgentFileRequest = Readonly<{
  path: string;
  content: string;
  baseRevision: string;
}>;

/**
 * An agent's code notes: one markdown document, stored in the database. `revision` is 0
 * while the agent has no notes; a save must name the revision it was based on.
 */
export type AgentCodeNotesDto = Readonly<{ content: string; revision: number }>;
export type UpdateAgentCodeNotesRequest = Readonly<{ content: string; baseRevision: number }>;

/**
 * A markdown note of the Notes page. The title is the note's first line, without heading
 * marks. `revision` is bumped on every content save; a content save must name the revision it
 * was based on.
 */
export type NoteSummaryDto = Readonly<{
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}>;
export type NoteDto = NoteSummaryDto &
  Readonly<{ content: string; revision: number; createdAt: string }>;
export type CreateNoteRequest = Readonly<{ content?: string }>;
/** Pinning is independent of content saves and needs no revision. */
export type UpdateNoteRequest = Readonly<
  { pinned?: boolean } & ({ content: string; baseRevision: number } | { content?: undefined })
>;

/** Declaration files of the kushibot library, for editor type checking. */
export type LibraryTypesDto = Readonly<{
  packageName: string;
  version: string | null;
  /** Paths relative to the package's declaration root, e.g. `index.d.ts`. */
  files: readonly Readonly<{ path: string; content: string }>[];
}>;

/** Declaration packages of the Node.js API, for editor type checking. */
export type NodeTypesDto = Readonly<{
  packages: readonly LibraryTypesDto[];
}>;

/**
 * Runs one chat message through an agent from `agents/`, against a project's workspace.
 * The agent's primary file must export `chat` (see plugins/README.md).
 */
export type StartAgentRunRequest = Readonly<{
  threadId?: string;
  agentName: string;
  message: string;
  /** Workspace-relative paths attached to the message. */
  files: readonly string[];
  /** Starts the agent under the debugger; breakpoints bind before any agent code runs. */
  debug: boolean;
  breakpoints?: DebugBreakpointsDto;
}>;
export type ChatThreadDto = Readonly<{
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}>;
export type ChatTurnDto = Readonly<{
  id: string;
  agentName: string;
  message: string;
  files: readonly string[];
  debug: boolean;
  createdAt: string;
  events: readonly AgentRunEventDto[];
}>;
export type ChatThreadDetailDto = ChatThreadDto & Readonly<{ turns: readonly ChatTurnDto[] }>;
/** Recorded file versions and publication state for a coding proposal. */
export type CodingProposalReviewDto = Readonly<{
  id: string;
  digest: string;
  summary: string;
  status: "ready" | "pending" | "applied" | "not-applied";
  code?: string;
  changes: readonly Readonly<{ path: string; before: string | null; after: string | null }>[];
}>;
export type CodingPublicationResultDto = Readonly<{
  status: "recorded" | "pending" | "waiting-for-approval" | "blocked" | "stopped";
  effect:
    | Readonly<{ status: "published"; receipt: Readonly<Record<string, string>> }>
    | Readonly<{ status: "not-applied"; code: string }>
    | null;
}>;
export type AgentRunStatus =
  "starting" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type AgentRunDto = Readonly<{
  id: string;
  projectId: string;
  agentName: string;
  debug: boolean;
  status: AgentRunStatus;
  startedAt: string;
}>;

/** Agent-relative source path → 1-based line numbers. */
export type DebugBreakpointsDto = Readonly<Record<string, readonly number[]>>;
/** Where one requested breakpoint bound; `line` moves to the next line with code. */
export type DebugBreakpointDto = Readonly<{
  file: string;
  requestedLine: number;
  line: number;
  verified: boolean;
}>;
export type DebugLocationDto = Readonly<{
  /** Agent-relative source path, or null for code outside the agent (kushibot, Node). */
  file: string | null;
  url: string;
  /** Identifies the generated script, for fetching the source of code outside the agent. */
  scriptId: string;
  /**
   * 1-based; in `file` when set, otherwise in the script's source: its original file (`url`)
   * when it has a readable source map, such as kushibot's TypeScript, else the script itself.
   */
  line: number;
  column: number;
}>;
/** `ref` names an object whose properties can be listed while the run is paused. */
export type DebugValueDto = Readonly<{ type: string; value: string; ref: string | null }>;
export type DebugVariableDto = DebugValueDto & Readonly<{ name: string }>;
export type DebugScopeDto = Readonly<{ type: string; name: string; ref: string | null }>;
export type DebugCallFrameDto = Readonly<{
  /**
   * Valid until the run resumes; null for callers across an `await`, which show where the
   * code came from but have no scopes to inspect.
   */
  id: string | null;
  /** On the first caller across an `await`: what it waited on, e.g. "await". */
  asyncBoundary?: string | null;
  name: string;
  location: DebugLocationDto;
  scopes: readonly DebugScopeDto[];
}>;
export type DebugCommand = "continue" | "pause" | "stepOver" | "stepInto" | "stepOut";
export type DebugCommandRequest = Readonly<{ command: DebugCommand }>;
/** Replaces the breakpoints of one file. */
export type SetBreakpointsRequest = Readonly<{ file: string; lines: readonly number[] }>;
/** Evaluates in the given paused frame, or globally when `frameId` is null. */
export type EvaluateRequest = Readonly<{ expression: string; frameId: string | null }>;
/** The original source of a script with a source map, otherwise the script itself. */
export type ScriptSourceDto = Readonly<{ scriptId: string; url: string; source: string }>;

/** Server-sent events of `GET /agent-runs/:id/events`, in order; a reconnect replays them. */
export type AgentRunEventDto =
  | Readonly<{ type: "status"; status: AgentRunStatus }>
  | Readonly<{ type: "progress"; message: string }>
  | Readonly<{ type: "output"; stream: "stdout" | "stderr"; text: string }>
  /** What `chat` returned, as JSON; cut to a text preview when it is too large. */
  | Readonly<{ type: "result"; value: unknown; truncated: boolean }>
  | Readonly<{ type: "error"; message: string; stack: string | null }>
  | Readonly<{
      type: "paused";
      /** "breakpoint", "step", "pause" (the Pause command), "debugger" (a statement) or V8's reason. */
      reason: string;
      frames: readonly DebugCallFrameDto[];
    }>
  | Readonly<{ type: "resumed" }>
  | Readonly<{ type: "breakpoints"; breakpoints: readonly DebugBreakpointDto[] }>;

/** One kushibot debug event as kushibot records it (`DebugEvent`, schema version 1). */
export type DebugEventDto = Readonly<{
  schemaVersion: 1;
  eventId: string;
  channel: "diagnostic" | "lifecycle";
  /** e.g. "operation.started", "operation.completed", "progress.reported", "policy.applied". */
  type: string;
  level: "trace" | "debug" | "info" | "warn" | "error";
  occurredAtEpochMs: number;
  producerId: string;
  scope: Readonly<{ scopeId: string; projectId: string; workspaceId?: string }>;
  identity: Readonly<{
    operationId: string;
    runId?: string;
    stepRunId?: string;
    sessionId?: string;
    parentOperationId?: string;
  }>;
  trace: Readonly<{
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    causationEventId: string | null;
  }>;
  payload: Readonly<{
    operation?: string;
    summary?: string;
    code?: string;
    count?: number;
    durationMs?: number;
    revision?: number;
    previousState?: string;
    nextState?: string;
    relatedRefs?: readonly string[];
    /** Named measurements: sizes in bytes, counts and token estimates. */
    metrics?: Readonly<Record<string, number>>;
  }>;
}>;
/** A debug event stored in PostgreSQL: its position in its kushibot stream (`run:<id>`). */
export type RecordedDebugEventDto = Readonly<{
  streamId: string;
  sequence: number;
  recordedAtEpochMs: number;
  event: DebugEventDto;
}>;
/**
 * `GET /agent-runs/:id/debug-events?after=<cursor>`: the kushibot debug events a chat run
 * recorded, oldest first. Pass `cursor` back as `after` to get only newer events.
 */
export type AgentRunDebugEventsDto = Readonly<{
  run: Readonly<{
    id: string;
    projectId: string;
    agentName: string;
    /** Null once the server no longer holds the run (runs live in memory). */
    status: AgentRunStatus | null;
    startedAt: string;
  }>;
  /** False when the server has no kushibot (`KUSHEX_KUSHIBOT_DIR`) to record events with. */
  recording: boolean;
  events: readonly RecordedDebugEventDto[];
  cursor: string;
  /** More events are already stored; ask again with `cursor` without waiting. */
  more: boolean;
}>;
