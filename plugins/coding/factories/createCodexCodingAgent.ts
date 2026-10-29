import {
  CodexCliTextGatewayFactory,
  type Agent,
  type CodexCliOptions,
  type EditingResult,
  type ModelProfile,
  type TaskInput,
} from "kushibot";
import type { CodingAgentOptions } from "../CodingAgentOptions";
import { createCodingAgent } from "./createCodingAgent";

/** Uses the installed Codex CLI and its saved auth.json; no API key is required. */
export function createCodexCodingAgent(
  options: Omit<CodingAgentOptions, "gateway" | "profile" | "clock"> & {
    readonly profile: ModelProfile;
    readonly codex?: CodexCliOptions;
  },
): Agent<TaskInput, EditingResult> {
  const { profile, codex, ...settings } = options;
  const gateway = new CodexCliTextGatewayFactory(codex).create(profile);
  return createCodingAgent({ ...settings, profile, gateway });
}
