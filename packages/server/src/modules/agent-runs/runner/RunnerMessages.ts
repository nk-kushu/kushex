/** Server → runner, over the child process IPC channel. */
export type RunnerCommand =
  | Readonly<{
      type: "start";
      entry: string;
      workspace: string;
      message: string;
      files: readonly string[];
    }>
  /** Calls the loaded agent's `chat`; sent once the debugger has bound its breakpoints. */
  | Readonly<{ type: "call" }>
  | Readonly<{ type: "cancel" }>;

/** Runner → server. */
export type RunnerReport =
  /** The agent's modules are imported; nothing of `chat` has run yet. */
  | Readonly<{ type: "loaded" }>
  | Readonly<{ type: "progress"; message: string }>
  /** A kushibot debug event, unchecked; the server validates it before storing it. */
  | Readonly<{ type: "debug"; event: unknown }>
  | Readonly<{ type: "result"; value: unknown; truncated: boolean }>
  | Readonly<{ type: "error"; message: string; stack: string | null }>;

/** Set by the server: the module URL that `import ... from "kushibot"` resolves to. */
export const KUSHIBOT_ENTRY_ENV = "KUSHEX_KUSHIBOT_ENTRY";
