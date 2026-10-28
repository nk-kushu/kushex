import type { AgentName } from "../domain/AgentName.js";

/** Source of a new agent's primary file: one kushibot-based agent as the default export. */
export class AgentTemplate {
  render(name: AgentName): string {
    return `import {
  DebugRecordingModelGateway,
  FrameworkConfigurationContract,
  FrameworkConfigurationResolver,
  OpenAiHttpTransport,
  OpenAiTextGatewayFactory,
  type FrameworkConfiguration,
  type IScopedDebugRecorderFactory,
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

/** What the Kushex chat passes to \`chat\`; see agents/README.md. */
export interface ChatRequest {
  readonly message: string;
  /** Workspace-relative files attached to the message. */
  readonly files: readonly string[];
  /** Absolute path of the project checkout. */
  readonly workspace: string;
  readonly signal: AbortSignal;
  progress(message: string): void;
  /** Records kushibot debug events, shown on the run's Debug events page. */
  readonly debug?: IScopedDebugRecorderFactory;
}

/** Runs one chat message: a single model call with the agent's instructions. */
export async function chat(request: ChatRequest): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY on the Kushex server to run this agent.");
  const runId = crypto.randomUUID();
  const debug = request.debug?.create({
    scope: { scopeId: "kushex-chat", projectId: agent.name },
    identity: { runId, operationId: runId },
  });
  const openAi = new OpenAiTextGatewayFactory(() => new OpenAiHttpTransport(apiKey, fetch)).create(
    model.profile,
  );
  const gateway = debug ? new DebugRecordingModelGateway(openAi, debug) : openAi;
  debug?.event("progress.reported", "info", { summary: \`Asking \${model.profile.modelId}\` });
  request.progress(\`Asking \${model.profile.modelId}\`);
  const reply = await gateway.generate(
    {
      instructions: agent.instructions,
      messages: [{ role: "user", text: request.message }],
      maxOutputTokens: model.profile.maxOutputTokens,
      inputTokenUpperBound: model.profile.contextTokens,
      promptCacheKey: null,
    },
    { operationId: runId, signal: request.signal, deadlineEpochMs: null, timeoutMs: 120_000 },
  );
  if (reply.status !== "completed") throw new Error(\`The model reply is \${reply.status}.\`);
  return reply.text;
}

export default agent;
`;
  }
}
