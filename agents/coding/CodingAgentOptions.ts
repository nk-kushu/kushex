import type { AgentRuntimeOptions } from "kushibot";

/** Only the host can register commands; model output selects a name, never a shell string. */
export interface CodingCheck {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
}
export interface CodingAgentOptions extends AgentRuntimeOptions {
  readonly workspace: string;
  readonly checks?: readonly CodingCheck[];
}
