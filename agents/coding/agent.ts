import {
  Agent,
  AgentRuntimeFactory,
  JsonValueContract,
  TaskInputContract,
  OpenAiHttpTransport,
  OpenAiTextGatewayFactory,
  type EditingResult,
  type ModelProfile,
  type TaskInput,
} from "kushibot";

import { CodingAgentDefinition } from "./CodingAgentDefinition";
import type { CodingAgentOptions } from "./CodingAgentOptions";

/** Coding is a configuration of the generic Kushibot Agent, without a subclass. */
export function createCodingAgent(options: CodingAgentOptions): Agent<TaskInput, EditingResult> {
  const { workspace, checks, ...runtime } = options;

  return new Agent({
    id: "coding",
    requestContract: new TaskInputContract(new JsonValueContract()),
    workflow: new CodingAgentDefinition(workspace, checks),
    runtime: new AgentRuntimeFactory(runtime),
  });
}

/** Provider composition remains explicit; credentials stay in the calling host. */
export function createOpenAiCodingAgent(
  options: Omit<CodingAgentOptions, "gateway" | "profile"> & {
    readonly apiKey: string;
    readonly profile: ModelProfile;
    readonly http?: typeof fetch;
  },
): Agent<TaskInput, EditingResult> {
  const { apiKey, profile, http = fetch, ...settings } = options;
  if (profile.providerId !== "openai")
    throw new Error("OpenAI composition requires an OpenAI model profile.");
  const clock = settings.clock ?? { nowEpochMs: () => Date.now() };
  const gateway = new OpenAiTextGatewayFactory(
    () => new OpenAiHttpTransport(apiKey, http),
    clock,
  ).create(profile);
  return createCodingAgent({ ...settings, profile, gateway, clock });
}

export type { CodingAgentOptions, CodingCheck } from "./CodingAgentOptions";
export default createCodingAgent;
