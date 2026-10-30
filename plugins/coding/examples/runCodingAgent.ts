import { createCodingAgent } from "../src/index";
import { LocalChatArtifacts } from "../src/integrations/kushex/LocalChatArtifacts";

const workspace = process.argv[2];
if (!workspace) throw new Error("Usage: runCodingAgent.ts /absolute/workspace");
const artifactServices = await LocalChatArtifacts.open(workspace);
try {
  const agent = createCodingAgent({
    provider: "codex-cli",
    workspace,
    artifacts: artifactServices.services.store, // initialized Kushibot SQLite/PostgreSQL store
    profile: {
      id: "coding-model",
      providerId: "codex-cli",
      modelId: "gpt-6.1-sol",
      contextTokens: 400_000,
      maxOutputTokens: 16_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
      supportsPromptCacheKey: false,
    },
    checks: [
      { id: "typecheck", command: "pnpm", args: ["typecheck"] },
      { id: "tests", command: "pnpm", args: ["test"] },
    ],
  });

  const result = await agent.run(
    {
      goal: "Fix callback expiry handling without changing password login.",
      acceptanceCriteria: ["Expired callbacks are rejected", "Password login still works"],
      filePaths: ["src/auth/callback.ts", "tests/auth/callback.test.ts"],
      sourceRefs: [],
    },
    {
      onProgress: console.log,
      // signal: an AbortController's signal,
    },
  );

  if (result.outcome.status === "finished") {
    console.log(result.outcome.outcome.status); // completed, stopped, or failed
    console.log(result.result); // validated EditingResult on success; otherwise null
  }
} finally {
  await artifactServices.close();
}
