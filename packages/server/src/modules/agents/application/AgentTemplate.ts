import type { AgentName } from "../domain/AgentName.js";

/** Source of a new agent's primary file: one kushibot-based agent as the default export. */
export class AgentTemplate {
  render(name: AgentName): string {
    return `import {
  FrameworkConfigurationContract,
  FrameworkConfigurationResolver,
  type FrameworkConfiguration,
  type ModelProfileRegistration,
} from "kushibot";

/** The model this agent runs on; registered with kushibot's ModelProfileRegistry. */
const model: ModelProfileRegistration = {
  profile: {
    id: "${name}-default",
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

/** Run limits; validated by kushibot's FrameworkConfigurationContract. */
const configuration: FrameworkConfiguration = {
  logEnabled: true,
  logLevel: "info",
  maxIterations: 20,
  maxSubAgents: 0,
  maxSubAgentDepth: 0,
};

/** Agent "${name}". Kushex keeps it in agents/${name}/; this primary file exports it. */
const agent = {
  name: "${name}",
  instructions: [
    "You are a careful assistant.",
    "Answer only from the context you are given and say when it is not enough.",
  ].join("\\n"),
  model,
  configuration,
  /** Applies per-run overrides to this agent's defaults. */
  resolveConfiguration(overrides: unknown = {}) {
    return new FrameworkConfigurationResolver(
      configuration,
      new FrameworkConfigurationContract(),
    ).resolve(overrides);
  },
};

export default agent;
`;
  }
}
