import type { IArtifactWriter, IScopedDebugRecorderFactory } from "kushibot";

/** What the Kushex chat passes to `chat`; see the plugin README.md. */
export interface ChatRequest {
  readonly message: string;
  readonly artifacts?: IArtifactWriter;

  /** Workspace-relative file allowlist; empty enables access throughout the workspace. */
  readonly files: readonly string[];

  /**
   * workspace is the absolute path to the project folder the agent will work in.
   */
  readonly workspace: string;

  /**
   * Cancellation signal supplied by the chat host. When the user clicks Stop,
   * the host aborts this signal so the agent can stop its work.
   * `readonly` prevents reassigning this property; the signal can still become aborted.
   */
  readonly signal: AbortSignal;

  /**
   * Reports a status message for the host to display in the chat.
   * For example: request.progress("Reading attached files...").
   * This callback returns no value; the final result is returned by chat().
   */
  progress(message: string): void;

  /**
   * Records kushibot debug events (workflow steps, model calls, tools, progress); Kushex
   * stores them in PostgreSQL and shows them on the run's Debug events page.
   */
  readonly debug?: IScopedDebugRecorderFactory;
}
