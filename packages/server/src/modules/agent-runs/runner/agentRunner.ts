/**
 * Entry point of the child process that runs one agent message. The server starts it with
 * tsx as a loader (and `--inspect-wait` in debug mode), then sends `start` over IPC. The
 * runner imports the agent, reports `loaded`, and calls `chat` when the server sends `call`
 * (in debug mode, once breakpoints are bound). This file is not imported by the server.
 */
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KUSHIBOT_ENTRY_ENV, type RunnerCommand, type RunnerReport } from "./RunnerMessages.js";

/** What an agent's `chat` export receives; documented in plugins/README.md. */
type ChatRequest = Readonly<{
  message: string;
  files: readonly string[];
  workspace: string;
  signal: AbortSignal;
  progress: (message: string) => void;
  /**
   * kushibot's `IScopedDebugRecorderFactory`, for `AgentRuntimeFactory`'s `debug` option: its
   * events are stored and shown on the run's Debug events page. Absent without kushibot.
   */
  debug?: unknown;
}>;

const MAX_RESULT_CHARS = 1_000_000;
/** Debug events waiting for IPC; past this the newest are dropped (kushibot counts them). */
const MAX_PENDING_DEBUG_EVENTS = 1000;
/** A debug sink that does not answer in this time is dropped for the rest of the run. */
const DEBUG_DELIVERY_TIMEOUT_MS = 10_000;
/** How long the run's last debug events may take to reach the server. */
const DEBUG_DRAIN_TIMEOUT_MS = 5000;
/** After reporting, a process kept alive by open handles is ended after this delay. */
const EXIT_GRACE_MS = 1000;

const kushibot = process.env[KUSHIBOT_ENTRY_ENV];
if (kushibot)
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === "kushibot"
        ? { url: kushibot, shortCircuit: true }
        : nextResolve(specifier, context),
  });

const controller = new AbortController();
let started = false;
/** Resolves when the server says to call the agent. */
let called!: () => void;
const call = new Promise<void>((resolve) => (called = resolve));

function report(message: RunnerReport): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected) return resolve();
    process.send!(message, () => resolve());
  });
}

let reported = false;
// The server went away (restart, crash): nobody is waiting for this run any more.
process.on("disconnect", () => process.exit(reported ? 0 : 1));

process.on("message", (command: RunnerCommand) => {
  if (command.type === "cancel") controller.abort(new Error("Cancelled from the chat."));
  else if (command.type === "call") called();
  else if (command.type === "start" && !started) {
    started = true;
    void run(command);
  }
});

async function run(command: Extract<RunnerCommand, { type: "start" }>): Promise<void> {
  try {
    const agent = (await import(pathToFileURL(command.entry).href)) as { chat?: unknown };
    if (typeof agent.chat !== "function")
      throw new Error(
        `${path.basename(path.dirname(command.entry))}/${path.basename(command.entry)} does not export a \`chat\` function, so it cannot run from the chat. See plugins/README.md.`,
      );
    await report({ type: "loaded" });
    await call;
    const debug = await debugRecording();
    const request: ChatRequest = {
      message: command.message,
      files: command.files,
      workspace: command.workspace,
      signal: controller.signal,
      progress: (message) => void report({ type: "progress", message: String(message) }),
      ...(debug ? { debug: debug.factory } : {}),
    };
    try {
      const value: unknown = await (agent.chat as (request: ChatRequest) => unknown)(request);
      await debug?.drain();
      await report({ type: "result", ...serialize(value) });
    } catch (error) {
      await debug?.drain();
      throw error;
    }
  } catch (error) {
    await report({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null,
    });
  }
  reported = true;
  process.disconnect?.();
  setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
}

/** The kushibot classes the debug recording uses, from the same module the agent imports. */
type KushibotDebugModule = Readonly<{
  BoundedDebugPublisher: new (
    sinks: readonly {
      id: string;
      sink: { send(event: unknown, signal: AbortSignal): Promise<void> };
    }[],
    maxPending: number,
    timeoutMs: number,
    health: unknown,
  ) => { drain(): Promise<void> };
  DebugHealthCounter: new () => unknown;
  DebugPayloadSanitizer: new () => { sanitize(value: unknown): Record<string, unknown> };
  EnvironmentLoggingOptionsReader: new (environment: NodeJS.ProcessEnv) => {
    read(base: { enabled: boolean; level: string }): unknown;
  };
  LoggingController: new (options: unknown) => unknown;
  ScopedDebugRecorderFactory: new (options: Record<string, unknown>) => unknown;
}>;

/**
 * kushibot debug recording whose events go to the server over IPC. The server stores them in
 * PostgreSQL; this process has no database access. Null when kushibot is not configured or is
 * too old to record agent runs. `KUSHIBOT_LOG_ENABLED` / `KUSHIBOT_LOG_LEVEL` apply (default:
 * enabled, level debug).
 */
async function debugRecording(): Promise<{ factory: unknown; drain(): Promise<void> } | null> {
  if (!kushibot) return null;
  try {
    const module = (await import(kushibot)) as Partial<KushibotDebugModule>;
    if (!module.ScopedDebugRecorderFactory || !module.BoundedDebugPublisher) return null;
    const lib = module as KushibotDebugModule;
    const health = new lib.DebugHealthCounter();
    const publisher = new lib.BoundedDebugPublisher(
      [{ id: "kushex", sink: { send: (event) => report({ type: "debug", event }) } }],
      MAX_PENDING_DEBUG_EVENTS,
      DEBUG_DELIVERY_TIMEOUT_MS,
      health,
    );
    const factory = new lib.ScopedDebugRecorderFactory({
      logging: new lib.LoggingController(
        new lib.EnvironmentLoggingOptionsReader(process.env).read({
          enabled: true,
          level: "debug",
        }),
      ),
      publisher,
      producerId: "kushex-agent-runner",
      sanitizer: new ChatDebugSanitizer(new lib.DebugPayloadSanitizer()),
      health,
    });
    return {
      factory,
      drain: () =>
        Promise.race([
          publisher.drain(),
          new Promise<void>((resolve) => setTimeout(resolve, DEBUG_DRAIN_TIMEOUT_MS).unref()),
        ]),
    };
  } catch (error) {
    process.stderr.write(
      `Debug events are off for this run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return null;
  }
}

/**
 * kushibot's sanitizer keeps only summaries from a fixed list; progress messages are free
 * text, so this keeps any summary, made single-line and cut to kushibot's 512-byte limit.
 */
class ChatDebugSanitizer {
  constructor(private readonly base: { sanitize(value: unknown): Record<string, unknown> }) {}

  sanitize(value: unknown): Record<string, unknown> {
    const payload = this.base.sanitize(value);
    const summary =
      typeof value === "object" && value !== null
        ? Object.getOwnPropertyDescriptor(value, "summary")?.value
        : undefined;
    if (typeof summary !== "string" || !summary.trim()) return payload;
    // eslint-disable-next-line no-control-regex
    let text = summary.replace(/[\u0000-\u001f]+/g, " ").trim();
    while (new TextEncoder().encode(text).byteLength > 512) text = text.slice(0, -1);
    return Object.freeze({ ...payload, summary: text });
  }
}

/** JSON of the result: cycles, bigints and errors become readable text. */
function serialize(value: unknown): Readonly<{ value: unknown; truncated: boolean }> {
  // Objects on the path from the root to the value being written; only these make a cycle.
  const ancestors: unknown[] = [];
  const text =
    JSON.stringify(value ?? null, function (this: unknown, _key, current: unknown) {
      if (typeof current === "bigint") return `${current}n`;
      if (current instanceof Error)
        return { name: current.name, message: current.message, stack: current.stack };
      if (current instanceof Map) return Object.fromEntries(current);
      if (current instanceof Set) return [...current];
      if (typeof current !== "object" || current === null) return current;
      while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(current)) return "[Circular]";
      ancestors.push(current);
      return current;
    }) ?? "null";
  return text.length > MAX_RESULT_CHARS
    ? { value: text.slice(0, MAX_RESULT_CHARS), truncated: true }
    : { value: JSON.parse(text) as unknown, truncated: false };
}
