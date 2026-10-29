import type { IArtifactWriter, IAgentRuntimeOptions } from "kushibot";

/** Only the host can register commands; model output selects a name, never a shell string. */
export interface CodingCheck {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
}
export interface CodingAgentOptions extends IAgentRuntimeOptions {
  readonly workspace: string;
  /** Host-configured Kushibot store; change payloads are written here. */
  readonly artifacts: IArtifactWriter;
  readonly checks?: readonly CodingCheck[];
}
