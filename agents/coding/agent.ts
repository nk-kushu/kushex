import {
  FrameworkConfigurationContract,
  FrameworkConfigurationResolver,
  type FrameworkConfiguration,
  type ModelProfileRegistration,
} from "kushibot";
import { CodingWorkflow } from "./CodingWorkflow";
import { instructions } from "./prompts/instructions";

const model: ModelProfileRegistration = {
  profile: {
    id: "coding-default",
    providerId: "openai",
    modelId: "gpt-5-mini",
    contextTokens: 400_000,
    maxOutputTokens: 16_000,
    maxRequestBytes: 1_048_576,
    maxResponseBytes: 1_048_576,
    supportsPromptCacheKey: true,
  },
  capabilities: ["text"],
};
const configuration: FrameworkConfiguration = {
  logEnabled: true,
  logLevel: "info",
  maxIterations: 30,
  maxSubAgents: 0,
  maxSubAgentDepth: 0,
};

const agent = {
  name: "coding",
  instructions,
  model,
  configuration,
  Workflow: CodingWorkflow,
  resolveConfiguration(overrides: unknown = {}) {
    return new FrameworkConfigurationResolver(
      configuration,
      new FrameworkConfigurationContract(),
    ).resolve(overrides);
  },
};
export default agent;
