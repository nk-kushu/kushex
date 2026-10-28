import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Logger } from "../../../shared/application/Logger.js";
import type { AgentLauncher, AgentLaunch, AgentRunProcess } from "../application/AgentLauncher.js";
import {
  KUSHIBOT_ENTRY_ENV,
  type RunnerCommand,
  type RunnerReport,
} from "../runner/RunnerMessages.js";
import { AgentDebugger } from "./AgentDebugger.js";
import { InspectorClient } from "./InspectorClient.js";
import { kushibotEntry } from "./kushibotEntry.js";

type Limits = Readonly<{
  /** A run is ended after this long; debug runs get longer, since they sit at breakpoints. */
  runTimeoutMs: number;
  debugRunTimeoutMs: number;
  /** After cancel, the agent has this long to stop on its abort signal before it is killed. */
  cancelGraceMs: number;
  /** How long a debug run waits for its inspector to start listening. */
  inspectorTimeoutMs: number;
}>;

/** Inspector messages Node prints to stderr; they are not the agent's output. */
const INSPECTOR_NOTICE =
  /^(Debugger listening on |Debugger ending on |For help, see: |Debugger attached\.|Waiting for the debugger to disconnect)/;
/** Server-only settings that agents have no use for. */
const PRIVATE_ENVIRONMENT = new Set(["DATABASE_URL", "POSTGRES_PASSWORD"]);

/**
 * Runs each agent message in its own Node process with tsx as the TypeScript loader, so a
 * crashing or hanging agent cannot take the server down. In debug mode the process waits
 * for the inspector, which the server attaches to before any agent code runs.
 */
export class ChildProcessAgentLauncher implements AgentLauncher {
  private readonly limits: Limits;
  private readonly runner: string;
  private readonly tsx: string;
  private readonly kushibotEntry: string | null;
  private tsconfig: string | null = null;

  constructor(
    kushibotDirectory: string | null,
    private readonly logger: Logger,
    limits: Partial<Limits> = {},
  ) {
    this.limits = {
      runTimeoutMs: 15 * 60_000,
      debugRunTimeoutMs: 2 * 60 * 60_000,
      cancelGraceMs: 5000,
      inspectorTimeoutMs: 10_000,
      ...limits,
    };
    // Next to this file in both src (run by tsx) and dist (compiled).
    const extension = path.extname(fileURLToPath(import.meta.url));
    this.runner = fileURLToPath(new URL(`../runner/agentRunner${extension}`, import.meta.url));
    this.tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    this.kushibotEntry = kushibotDirectory ? kushibotEntry(kushibotDirectory) : null;
  }

  launch(launch: AgentLaunch): AgentRunProcess {
    const { run } = launch;
    const debug = run.debug;
    const child = fork(this.runner, [], {
      cwd: launch.workspace,
      execArgv: ["--import", this.tsx, ...(debug ? ["--inspect-wait=127.0.0.1:0"] : [])],
      env: this.environment(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "json",
    });
    /** What the agent reported last, or what ended it from here. */
    let outcome: "result" | "error" | null = null;
    let cancelled = false;
    const fail = (message: string) => {
      outcome = "error";
      run.emit({ type: "error", message, stack: null });
    };
    let inspector: InspectorClient | null = null;
    let debuggerSession: AgentDebugger | null = null;
    const detachDebugger = () => {
      run.attachDebugger(null);
      debuggerSession?.dispose();
      debuggerSession = null;
      inspector?.close();
      inspector = null;
    };
    const kill = () => {
      detachDebugger();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const timeout = setTimeout(
      () => {
        fail("The run took too long and was stopped.");
        kill();
      },
      debug ? this.limits.debugRunTimeoutMs : this.limits.runTimeoutMs,
    );
    const start = () => {
      const command: RunnerCommand = {
        type: "start",
        entry: launch.entry,
        workspace: launch.workspace,
        message: launch.message,
        files: launch.files,
      };
      child.send(command);
      run.emit({ type: "status", status: "running" });
    };

    child.on("message", (report: RunnerReport) => {
      if (report.type === "loaded") {
        void (debuggerSession?.settled() ?? Promise.resolve()).then(() => {
          if (child.connected) child.send({ type: "call" } satisfies RunnerCommand);
        });
        return;
      }
      if (report.type === "progress") return run.emit(report);
      if (report.type === "debug") return launch.recordDebugEvent(report.event);
      outcome = report.type;
      run.emit(report);
      // A process with an inspector attached waits for it to disconnect before exiting.
      detachDebugger();
    });
    this.forwardOutput(child, run.emit.bind(run), (url) => {
      void this.attach(url, launch, (event) => run.emit(event))
        .then((attached) => {
          inspector = attached.inspector;
          debuggerSession = attached.session;
          if (run.finished) return detachDebugger();
          run.attachDebugger(attached.session);
          start();
        })
        .catch((error: unknown) => {
          fail(
            `Could not attach the debugger: ${error instanceof Error ? error.message : String(error)}`,
          );
          kill();
        });
    });
    if (debug) {
      const waiting = setTimeout(() => {
        if (inspector) return;
        fail("The debugger did not start in time.");
        kill();
      }, this.limits.inspectorTimeoutMs);
      child.once("exit", () => clearTimeout(waiting));
    } else start();

    child.on("error", (error) => {
      this.logger.error({ err: error, runId: run.id }, "Agent process failed.");
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      detachDebugger();
      if (cancelled) return run.emit({ type: "status", status: "cancelled" });
      if (outcome === null)
        fail(`The agent process exited unexpectedly (${signal ?? `code ${code}`}).`);
      run.emit({ type: "status", status: outcome === "result" ? "completed" : "failed" });
    });

    return {
      cancel: () => {
        if (cancelled || child.exitCode !== null) return;
        cancelled = true;
        // Detaching resumes a paused process, so it can receive the cancel message.
        detachDebugger();
        if (child.connected) child.send({ type: "cancel" } satisfies RunnerCommand);
        setTimeout(kill, this.limits.cancelGraceMs).unref();
      },
      kill: () => {
        cancelled = true;
        kill();
      },
    };
  }

  private async attach(
    url: string,
    launch: AgentLaunch,
    emit: AgentLaunch["run"]["emit"],
  ): Promise<{ inspector: InspectorClient; session: AgentDebugger }> {
    const inspector = await InspectorClient.connect(url);
    const session = new AgentDebugger(inspector, launch.agentDirectory, launch.breakpoints, emit);
    await session.start();
    return { inspector, session };
  }

  /** Streams stdout/stderr as output events and reports the inspector URL once it appears. */
  private forwardOutput(
    child: ChildProcess,
    emit: AgentLaunch["run"]["emit"],
    onInspector: (url: string) => void,
  ): void {
    child
      .stdout!.setEncoding("utf8")
      .on("data", (text: string) => emit({ type: "output", stream: "stdout", text }));
    let pending = "";
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const output: string[] = [];
      for (const line of lines) {
        const url = /^Debugger listening on (ws:\/\/\S+)/.exec(line)?.[1];
        if (url) onInspector(url);
        if (!INSPECTOR_NOTICE.test(line)) output.push(`${line}\n`);
      }
      if (output.length) emit({ type: "output", stream: "stderr", text: output.join("") });
    });
    child.stderr!.on("end", () => {
      if (pending && !INSPECTOR_NOTICE.test(pending))
        emit({ type: "output", stream: "stderr", text: pending });
    });
  }

  private environment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env))
      if (!PRIVATE_ENVIRONMENT.has(name) && name !== "NODE_OPTIONS") environment[name] = value;
    environment.TSX_TSCONFIG_PATH = this.compilerOptions();
    if (this.kushibotEntry) environment[KUSHIBOT_ENTRY_ENV] = this.kushibotEntry;
    return environment;
  }

  /**
   * tsx reads the agent folder's tsconfig by default, which may extend files that only
   * exist in a development checkout; agents run with these neutral options instead.
   */
  private compilerOptions(): string {
    if (this.tsconfig) return this.tsconfig;
    const directory = path.join(tmpdir(), "kushex-agent-runner");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "tsconfig.json");
    writeFileSync(
      file,
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      }),
    );
    return (this.tsconfig = file);
  }
}
