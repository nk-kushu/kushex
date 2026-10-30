import assert from "node:assert/strict";
import type { IModelGateway, ModelProfile, ModelRequest } from "kushibot";

export const profile: ModelProfile = {
  id: "coding-test",
  providerId: "openai",
  modelId: "test-model",
  contextTokens: 100_000,
  maxOutputTokens: 4096,
  maxRequestBytes: 1_048_576,
  maxResponseBytes: 1_048_576,
  supportsPromptCacheKey: false,
};

type Action = unknown | ((request: ModelRequest) => unknown);
export class ScriptedGateway implements IModelGateway {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly actions: Action[]) {}
  async generate(request: ModelRequest) {
    this.requests.push(request);
    const action = this.actions.shift();
    assert.notEqual(action, undefined, "Unexpected model call");
    return {
      status: "completed" as const,
      text: typeof action === "function" ? JSON.stringify(action(request)) : JSON.stringify(action),
      providerId: profile.providerId,
      modelId: profile.modelId,
      responseId: "test-response",
      errorCode: null,
      usage: {
        inputTokens: 100,
        outputTokens: 100,
        cachedInputTokens: null,
        reasoningTokens: null,
      },
    };
  }
}
