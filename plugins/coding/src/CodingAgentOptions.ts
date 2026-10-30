import type { CodexCliOptions, IArtifactWriter, IAgentRuntimeOptions } from "kushibot";
import type { CodingCompressionSettings } from "./context/createCodingCompression";

/** Only the host can register commands; model output selects a name, never a shell string. */
export interface CodingCheck {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
}
/** Common run settings plus exactly one model connection choice. */
export type CodingAgentOptions = Omit<IAgentRuntimeOptions, "gateway"> & {
  readonly workspace: string;
  /** Host-configured Kushibot store; change payloads are written here. */
  readonly artifacts: IArtifactWriter;
  readonly checks?: readonly CodingCheck[];
  /**
   * Opt in to context compression for this agent's sessions.
   *
   * Omitted (the default) keeps kushibot's `AgentModelTurn`: one growing conversation that
   * stops at the window limit. Supplying this switches sessions to a fragment-based context
   * that collapses repeated observations into verified summaries stored as artifacts.
   *
   * It is off by default because it changes the prompt shape the model sees — see
   * `CompressingCodingTurn` for what changes and why.
   */
  readonly compression?: CodingCompressionSettings & { readonly enabled: boolean };
} & (
    | {
        readonly gateway: IAgentRuntimeOptions["gateway"];
        readonly provider?: never;
        readonly codex?: never;
      }
    | {
        readonly provider: "codex-cli";
        readonly codex?: CodexCliOptions;
        readonly gateway?: never;
      }
  );
