import type {
  DebugBreakpointDto,
  DebugBreakpointsDto,
  DebugCommand,
  DebugValueDto,
  DebugVariableDto,
  ScriptSourceDto,
} from "@kushex/contracts";
import type { AgentRun } from "./AgentRun.js";

export type AgentLaunch = Readonly<{
  run: AgentRun;
  /** Absolute path of the agent's primary file, which exports `chat`. */
  entry: string;
  /** Real path of the agent folder; breakpoint paths are relative to it. */
  agentDirectory: string;
  /** Absolute path of the project checkout; the agent's working directory. */
  workspace: string;
  message: string;
  files: readonly string[];
  breakpoints: DebugBreakpointsDto;
  /** Stores a kushibot debug event the agent reported; it is validated, not trusted. */
  recordDebugEvent(event: unknown): void;
}>;

export interface AgentRunProcess {
  /** Asks the agent to stop through its abort signal, then ends the process. */
  cancel(): void;
  /** Ends the process at once. */
  kill(): void;
}

export interface AgentRunDebugger {
  readonly paused: boolean;
  command(command: DebugCommand): Promise<void>;
  setBreakpoints(file: string, lines: readonly number[]): Promise<readonly DebugBreakpointDto[]>;
  evaluate(expression: string, frameId: string | null): Promise<DebugValueDto>;
  variables(ref: string): Promise<readonly DebugVariableDto[]>;
  source(scriptId: string): Promise<ScriptSourceDto>;
}

/** Runs an agent outside the server process and reports through the run's events. */
export interface AgentLauncher {
  launch(launch: AgentLaunch): AgentRunProcess;
}
