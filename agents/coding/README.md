# Coding agent

`agent.ts` exports **`createCodingAgent(options)`** as its default export. It
returns Kushibot's `Agent<TaskInput, EditingResult>`, configured for coding.
There is no coding-specific agent subclass or locally implemented runtime.

Kushibot owns `Agent`, `AgentRuntimeFactory`, engine/session composition, stores,
model conversations, budgets, cancellation, and run results. Kushex supplies
`CodingAgentDefinition`, the plan/edit workflow, session binding policies, prompts,
workspace tools, and verification rules. See the library's
[generic agent API](../../../kushibot/docs/generic-agents.md).

## Run with OpenAI

Use Node.js 22.18+ and build the sibling `kushibot` checkout first. From `kushex`,
install the usual workspace dependencies. An application can use this composition:

```ts
import { createOpenAiCodingAgent } from "./agents/coding/agent";

const agent = createOpenAiCodingAgent({
  workspace: "/absolute/path/to/project",
  apiKey: process.env.OPENAI_API_KEY!,
  profile: {
    id: "coding-model",
    providerId: "openai",
    modelId: "gpt-5-mini",
    contextTokens: 400_000,
    maxOutputTokens: 16_000,
    maxRequestBytes: 1_048_576,
    maxResponseBytes: 1_048_576,
    supportsPromptCacheKey: true,
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
```

Use a model ID and limits supported by your provider. The helper uses Kushibot's
`OpenAiHttpTransport` and `OpenAiTextGatewayFactory`; no separate provider SDK or
credentials are bundled. For another provider or an existing gateway, construct
`createCodingAgent({ workspace, gateway, profile, checks })` with an `IModelGateway`.
When running source with the workspace's tsx loader, use this agent's
`tsconfig.json`; it resolves the sibling Kushibot package. For example, from `kushex`:

```sh
TSX_TSCONFIG_PATH=agents/coding/tsconfig.json \
  node --import ./packages/server/node_modules/tsx/dist/loader.mjs ./your-runner.ts
```

## Execution

1. Validate the task and initialize an isolated run, usage ledger, and journal.
2. Plan with read-only file tools. Planning returns a validated `TaskInput`:
   ordered steps in `goal`, expected outcomes/checks in `acceptanceCriteria`, and
   proposed targets in `filePaths`. Its paths must remain inside the task allowlist.
3. Start editing only after the workflow accepts the plan. The editor receives
   the original task and the full accepted plan directly from the run store.
4. Edit through tools and run registered checks. The model selects a check by ID;
   command and arguments come from the host, with `shell: false`.
5. Accept the result only when reported snapshots and change references match
   actual files, no unresolved items remain, and all registered checks passed on
   the current permitted files. Every edit invalidates earlier checks.

The model returns JSON actions, which Kushibot's `AgentActionParser` processes.
The bound tools are `read_file`, `write_file`, `run_check`, and `status`; planning
can call only `read_file`. Writes require the content hash from a prior read.
New files use `expectedHash: null`; missing parent directories are created.

`run(task, controls)` returns the engine outcome, typed `result`, full workflow snapshot, usage ledger,
session journal, and change artifacts containing actual before/after contents.
Do not infer success just because the promise resolved: inspect the outcome.
Stopped or pending runs retain their partial results. An unresolved provider call
is returned as pending and is not automatically dispatched again.

## Scope and limits

- `filePaths` is an explicit allowlist for both reads and writes, up to 16 files.
  Include relevant project instructions and test files. Parent traversal, symbolic
  links, hard-linked files, and non-regular files are rejected. Deletion is not
  currently exposed as a tool.
- Files are limited to 64 KiB; each model action is limited to 16 KiB by Kushibot.
  This runner suits small, bounded changes. External `sourceRefs` are rejected;
  supply context through permitted files.
- Registered commands are trusted host configuration and run with host permissions
  in the workspace. File tools are not an OS sandbox for check commands or hostile
  concurrent filesystem changes. Use a dedicated working copy.
- Verification covers the listed files and configured checks. Register relevant
  checks: with `checks: []`, completion validates change evidence but does not
  independently prove the task's semantic acceptance criteria.
- Default limits: 30 turns per session, 10-minute run deadline, 60-second model
  and command timeouts, 120 model calls/iterations, and 100 tool calls across the
  run. Token limits are shared across phases and configurable through `limits`.
- One run at a time per instance; each subsequent run receives fresh state.
  The default stores and artifacts are in memory, with no process-restart recovery.
  Supply a Kushibot `IAgentRunStoreFactory` through `stores` to use host storage adapters. Changes
  are applied directly and retained on failure/cancellation; no automatic rollback,
  commit, push, or publication occurs.
- Kushex can display/edit these files. This change does not add a Run button or
  server execution endpoint to the panel.

## Validation

From `kushex`:

```sh
pnpm typecheck:agent:coding
pnpm test:agent:coding
```

Tests use scripted gateways and a temporary workspace. They exercise the real
Kushibot workflow/session engines, filesystem writes and check processes, and an
OpenAI HTTP adapter with a fake transport response. No paid model calls occur.

The creation API changed from `new CodingAgent(options)` to
`createCodingAgent(options)` (or the OpenAI helper). Execution controls moved from
task fields to the second argument of `run(task, { signal, onProgress })`.
