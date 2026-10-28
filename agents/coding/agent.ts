import {
  type Agent,
  type IArtifactWriter,
  OpenAiHttpTransport,
  OpenAiTextGatewayFactory,
  type EditingResult,
  type IScopedDebugRecorderFactory,
  type ModelProfile,
  type TaskInput,
} from "kushibot";

import { LocalChatArtifacts } from "./infrastructure/LocalChatArtifacts";
import type { CodingAgentOptions } from "./CodingAgentOptions";
import { createCodingAgent } from "./factories/createCodingAgent";
import { createCodexCodingAgent } from "./factories/createCodexCodingAgent";

export { createCodingAgent } from "./factories/createCodingAgent";
export { createCodexCodingAgent } from "./factories/createCodexCodingAgent";

/** Provider composition remains explicit; credentials stay in the calling host. */
export function createOpenAiCodingAgent(
  options: Omit<CodingAgentOptions, "gateway" | "profile" | "clock"> & {
    readonly apiKey: string;
    readonly profile: ModelProfile;
    readonly http?: typeof fetch;
  },
): Agent<TaskInput, EditingResult> {
  const { apiKey, profile, http = fetch, ...settings } = options;
  if (profile.providerId !== "openai")
    throw new Error("OpenAI composition requires an OpenAI model profile.");
  const gateway = new OpenAiTextGatewayFactory(() => new OpenAiHttpTransport(apiKey, http)).create(
    profile,
  );
  return createCodingAgent({ ...settings, profile, gateway });
}

/** What the Kushex chat passes to `chat`; see agents/README.md. */
export interface ChatRequest {
  readonly message: string;
  readonly artifacts?: IArtifactWriter;

  /** Workspace-relative file allowlist; empty enables access throughout the workspace. */
  readonly files: readonly string[];

  /**
   * workspace is the absolute path to the project folder the agent will work in.
   */
  readonly workspace: string;

  /**
   * Cancellation signal supplied by the chat host. When the user clicks Stop,
   * the host aborts this signal so the agent can stop its work.
   * `readonly` prevents reassigning this property; the signal can still become aborted.
   */
  readonly signal: AbortSignal;

  /**
   * Reports a status message for the host to display in the chat.
   * For example: request.progress("Reading attached files...").
   * This callback returns no value; the final result is returned by chat().
   */
  progress(message: string): void;

  /**
   * Records kushibot debug events (workflow steps, model calls, tools, progress); Kushex
   * stores them in PostgreSQL and shows them on the run's Debug events page.
   */
  readonly debug?: IScopedDebugRecorderFactory;
}

/**
 * Chat turns one chat message into a coding task,
 * runs the agent, and returns its execution result.
 */
export async function chat(request: ChatRequest) {
  const localArtifacts = request.artifacts
    ? null
    : await LocalChatArtifacts.open(request.workspace, process.env.KUSHEX_ARTIFACTS_DIR);
  const artifacts = request.artifacts ?? localArtifacts!.services.store;
  try {
    const agent = createCodexCodingAgent({
      workspace: request.workspace,
      artifacts,
      ...(request.debug ? { debug: request.debug } : {}),
      codex: {
        executable: process.env.CODEX_EXECUTABLE || undefined,
        codexHome: process.env.CODEX_HOME || undefined,
      },
      profile: {
        id: "coding-chat",
        providerId: "codex-cli",
        modelId: process.env.CODEX_MODEL || "gpt-6.1-sol",
        contextTokens: 400_000,
        maxOutputTokens: 16_000,
        maxRequestBytes: 1_048_576,
        maxResponseBytes: 1_048_576,
        supportsPromptCacheKey: false,
      },
    });

    return await agent.run(
      {
        goal: request.message,
        acceptanceCriteria: ["The change the goal asks for is made in the permitted files."],
        filePaths: [...request.files],
        sourceRefs: [],
      },
      { signal: request.signal, onProgress: (message) => request.progress(message) },
    );
  } finally {
    await localArtifacts?.close();
  }
}

export type { CodingAgentOptions, CodingCheck } from "./CodingAgentOptions";
export default createCodingAgent;
