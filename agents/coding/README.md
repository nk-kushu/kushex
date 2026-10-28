# Coding agent

`agent.ts` exports **`createCodingAgent(options)`** as its default export. It
returns Kushibot's `Agent<TaskInput, EditingResult>`, configured for coding.
There is no coding-specific agent subclass or locally implemented runtime.

Kushibot owns `Agent`, `AgentRuntimeFactory`, engine/session composition, stores,
model conversations, budgets, cancellation, and run results. Kushex supplies
`AgentWorkflow`, the plan/edit workflow, session binding policies, prompts,
workspace tools, and verification rules. See the library's
[generic agent API](../../../kushibot/docs/generic-agents.md).

## Run with Codex CLI

Use Node.js 22.18+ and build the sibling `kushibot` checkout first. From `kushex`,
install the usual workspace dependencies. An application can use this composition:

```ts
import { createCodexCodingAgent } from "./agents/coding/factories/createCodexCodingAgent";

const agent = createCodexCodingAgent({
  workspace: "/absolute/path/to/project",
  artifacts: artifactServices.store, // initialized Kushibot SQLite/PostgreSQL store
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
```

Run `codex login` on the server's host first. `createCodexCodingAgent` uses
Kushibot's `CodexCliTextGatewayFactory` and the existing `$CODEX_HOME/auth.json`
(default `~/.codex/auth.json`). No `OPENAI_API_KEY` is required. Optional
`codex: { executable, codexHome }` settings select another CLI or auth directory.
Use a model ID available to your Codex account and suitable workload limits.
See [the library's CLI adapter guide](../../../kushibot/docs/codex-cli.md) for
token-budget and CLI-session limitations.

Programmatic callers supply an initialized Kushibot artifact writer, such as
`SqliteArtifactStoreFactory(...).create(producer).store` after initializing its schema.
Configure its capture policy for `application/json` and `text/plain` (for publication content) and allow up to 1 MiB per change
(the JSON contains both file versions). See [Kushibot's artifact example](../../../kushibot/examples/artifacts/main.ts).

`KUSHEX_ARTIFACTS_DIR` can select a shared artifact directory; the server must use the same location.

Local `chat()` defaults to Kushibot's `LocalWorkspaceArtifacts` SQLite store in
`~/.kushex/artifacts/<workspace-hash>.sqlite`, outside the editable workspace.
Artifacts persist after the run; the connection closes when chat finishes.
A host can override this with `request.artifacts`. The default store bounds each
artifact to 1 MiB and each workspace to 100,000 artifacts / 1 GiB; it does not
expire changes automatically.

The panel's `chat()` entry point uses this adapter with `CODEX_MODEL` (default
`gpt-6.1-sol`), `CODEX_HOME`, and optional `CODEX_EXECUTABLE`. Docker images include
the CLI; Compose mounts `${KUSHEX_CODEX_HOME_HOST:-$HOME/.codex}` at `/codex` so the
backend can use and refresh your saved login. Rebuild/recreate the backend after
changing the Docker image or environment. The server user must be able to read
and write the authentication directory. Project mounts must be writable for accepted proposals to be applied. Compose provides
a writable mount; agent file tools edit the per-run copy before publication.

`createOpenAiCodingAgent({ apiKey, profile, ...settings })` remains available for
explicit OpenAI HTTP use. For another provider or an existing gateway, construct
`createCodingAgent({ workspace, gateway, profile, checks, artifacts })` with an `IModelGateway`.
`createOpenAiCodingAgent` uses Kushibot's default system clock for the gateway and
runtime; no clock parameter is needed. Tests that need a custom clock can compose
`createCodingAgent` with a gateway using the same clock.
When running source with the workspace's tsx loader, use this agent's
`tsconfig.json`; it resolves the sibling Kushibot package. For example, from `kushex`:

```sh
TSX_TSCONFIG_PATH=agents/coding/tsconfig.json \
  node --import ./packages/server/node_modules/tsx/dist/loader.mjs ./your-runner.ts
```

## Execution

1. Validate the task, create a retained filesystem working copy, and initialize an isolated run, usage ledger, and journal.
2. Plan with read-only file tools. Planning returns a validated `TaskInput`:
   ordered steps in `goal`, expected outcomes/checks in `acceptanceCriteria`, and
   proposed targets in `filePaths`. Its paths must remain inside the task allowlist when one is supplied.
3. Start editing only after the workflow accepts the plan. The editor receives
   the original task and the full accepted plan directly from the run store.
4. Edit through tools and run registered checks. The model selects a check by ID;
   command and arguments come from the host, with `shell: false`.
5. Accept the result only when reported snapshots and change references match
   actual files, no unresolved items remain, and all registered checks passed on
   the current permitted files. Every edit invalidates earlier checks.

The model returns JSON actions, which Kushibot's `AgentActionParser` processes.
The bound tools are `list_files`, `read_file`, `write_file`, `run_check`, and `status`; planning
can call `list_files` and `read_file`. Directory listings omit symlinks, `.git`, and
`node_modules`, and return up to 256 entries per directory. Writes require the content hash from a prior read.
New files use `expectedHash: null`; missing parent directories are created.

Each run copies the supplied project into a new temporary directory (excluding `.git`). Planning, editing, and checks use that copy. `runResult.artifacts.workingCopy` contains its absolute path; the host owns cleanup of its parent directory after review. Changes are not automatically applied to the source project. Copies consume disk space, include dependencies, and retain symlinks; check commands are trusted and are not sandboxed.

`run(task, controls)` returns the engine outcome, typed `result`, full workflow snapshot, usage ledger,
session journal, and artifact references. Change payloads (`path`, `before`, `after`)
are written through the required `artifacts: IArtifactWriter` option.
`result.changeArtifactRefs` contains `artifact:<id>` keys; `runResult.artifacts[key]`
contains the full Kushibot `ArtifactRef`, which the configured store can read.
Repeated status/completion checks reuse the same stored reference.
Do not infer success just because the promise resolved: inspect the outcome.
Stopped or pending runs retain their partial results. An unresolved provider call
is returned as pending and is not automatically dispatched again.

## Workspace tool design

`WorkspaceTools` composes Kushibot's `ToolRegistry`, `ToolDispatcher`, and
`BoundedToolRunner`. The dispatcher owns argument/result validation, scope checks,
authorization, usage accounting, execution bounds, and operation receipt replay.

The classes in `tools/` implement the actions available to the agent. File tools own
path validation; shared completion evidence lives in Kushibot’s `workspaces/` module:

- `ListFilesTool`, `ReadFileTool`, `WriteFileTool`, `RunCheckTool`, and `StatusTool`
  implement Kushibot's `ITool` interface with descriptors and validation contracts.
  Kushibot’s `JoiArgumentsContract` validates the fields and supplies their input schema.
- The file tools own listing, safe reads, safe writes, and their path validation.
- Kushibot’s `WorkspaceEvidence` owns tracked baselines, snapshot/change references, and
  check results used to verify completion. It stores change payloads through Kushibot
  and retains only their references locally.
- `RunCheckTool` owns trusted command execution and process cleanup.
- Kushibot’s `InMemoryToolOperationJournal` implements Kushibot's `IToolOperationJournal`:
  completed operations replay their receipts; pending operations are not repeated.
  Receipts are isolated per run and do not survive process restarts.

For example, Kushibot dispatches `write_file` through `ToolDispatcher` to
`WriteFileTool`. The tool checks the expected hash, writes the file directly, and invalidates earlier checks in `WorkspaceEvidence`.
Planning exposes only `list_files` and `read_file`; the same availability list
controls prompt descriptions and dispatcher authorization. Unavailable tools return
`TOOL_NOT_AVAILABLE`; malformed arguments return `TOOL_ARGUMENTS_INVALID`.
Recoverable workspace errors remain observations so the model can correct them.
If an operation times out before its result is known, Kushibot may return a pending
run requiring reconciliation, even after cancellation has been sent to the process.

## Scope and limits

- Empty `filePaths` (or no chat attachments) enables reads and writes throughout
  the workspace, including new files. Nonempty `filePaths` is an explicit allowlist
  for both reads and writes, up to 16 files.
  Include relevant project instructions and test files. Parent traversal, symbolic
  links, hard-linked files, and non-regular files are rejected. Deletion is not
  currently exposed as a tool.
- Files are limited to 64 KiB; each model action is limited to 16 KiB by Kushibot.
  This runner suits small, bounded changes. External `sourceRefs` are rejected;
  supply context through permitted files.
- Registered commands are trusted host configuration and run with host permissions
  in the workspace. File tools are not an OS sandbox for check commands or hostile
  concurrent filesystem changes. Checks can access paths outside the working copy.
- In workspace mode, file baselines are captured on first read/write; snapshots
  and verification cover those tracked files and configured checks, rather than
  every file in the repository. Discovering another file invalidates earlier checks.
  In allowlist mode, all listed files are tracked from initialization. Register relevant
  checks: with `checks: []`, completion validates change evidence but does not
  independently prove the task's semantic acceptance criteria.
- Default limits: 30 turns per session, 10-minute run deadline, 60-second model
  and command timeouts, 120 model calls/iterations, and 100 tool calls across the
  run. Token limits are shared across phases and configurable through `limits`.
- One run at a time per instance; each subsequent run receives fresh state.
  The default workflow stores are in memory, with no process-restart recovery.
  Change artifacts use the configured writer; local chat persists them in SQLite.
  Supply a Kushibot `IAgentRunStoreFactory` through `stores` to use host storage adapters. Changes
  are retained in the working copy on failure/cancellation; no automatic rollback,
  commit, push, or publication occurs.
- In project chat, completed coding runs with changes prepare durable proposals.
  **Review changes** opens the recorded versions in Monaco; **Accept and apply**
  approves the displayed proposal digest. Changed target files block application.
  Uncertain outcomes remain pending and can be reconciled without repeating writes.
  Reopening a saved chat restores the proposal and its publication state.

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
