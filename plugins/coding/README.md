# Coding agent plugin

This independent package is registered by [`kushex-plugin.json`](kushex-plugin.json)
as **Coding Agent**. It contributes agent `coding` from this directory (`agent.ts`).
Kushex discovers it through `KUSHEX_PLUGINS_DIR`, which defaults to the parent
`plugins/` directory. There is no Local Agents wrapper or automatic registration.

`agent.ts` exports **`createCodingAgent(options)`** as its default export. It
returns Kushibot's `Agent<TaskInput, EditingResult>`, configured for coding.
There is no coding-specific agent subclass or locally implemented runtime.

Kushibot owns `Agent`, `AgentRuntimeFactory`, engine/session composition, stores,
model conversations, budgets, cancellation, and run results. Kushex supplies
`CodingRunWorkflow`, the plan/edit workflow, session binding policies, prompts,
workspace tools, and verification rules. See the library's
[generic agent API](../../../kushibot/docs/generic-agents.md).

## Folder structure

- `agent.ts`: Kushex entry point; re-exports the public API and chat adapter.
- `src/index.ts`: public factories and configuration types for programmatic callers.
- `src/composition/`: Codex CLI construction and dependency wiring.
- `src/workflow/`: run setup, step dependencies, acceptance, and result mapping.
- `src/steps/`: planning and editing session policies with their instructions; shared instructions live in `steps/instructions.ts`.
- `src/tools/`: model-facing capabilities and tool registration.
- `src/infrastructure/`: concrete workspace and sandbox implementations.
- `src/integrations/kushex/`: chat request translation and local chat artifacts.
- `examples/`: runnable programmatic usage; pass an absolute workspace path.
- `tests/`: behavior tests and fixtures.

`src/context/compression/`, `src/memory/`, and `src/infrastructure/memory/`
are empty extension folders. This agent does not implement memory or compression.
Git does not retain empty directories; recreate these folders after a fresh checkout if needed.
Kushibot continues to own execution, sessions, budgets, and shared contracts.

## Run with Codex CLI

Use Node.js 22.18+ and build the sibling `kushibot` checkout first. From `kushex`,
install the usual workspace dependencies. An application can use this composition:

```ts
import { createCodingAgent } from "./plugins/coding/src/index";

const agent = createCodingAgent({
  provider: "codex-cli",
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

Run `codex login` on the server's host first. `createCodingAgent` uses
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
and write the authentication directory. Project mounts must be writable for the agent to edit files. Compose provides
a writable mount; the agent edits the supplied workspace directly.

Tests can supply an existing `IModelGateway` through
`createCodingAgent({ workspace, gateway, profile, checks, artifacts })`.
When injecting a custom clock, configure the gateway with the same clock.

When running source with the workspace's tsx loader, use this agent's
`tsconfig.json`; it resolves the sibling Kushibot package. For example, from `kushex`:

```sh
TSX_TSCONFIG_PATH=plugins/coding/tsconfig.json \
  node --import ./packages/server/node_modules/tsx/dist/loader.mjs ./your-runner.ts
```

## Execution

1. Validate the task, bind tools to the supplied workspace, and initialize a run, usage ledger, and journal.
2. Plan with a read-only sandboxed CLI. Planning returns a validated `TaskInput`:
   ordered steps in `goal`, expected outcomes/checks in `acceptanceCriteria`, and
   proposed targets in `filePaths`. Its paths must remain inside the task allowlist when one is supplied.
3. Start editing only after the workflow accepts the plan. The editor receives
   the original task and the full accepted plan directly from the run store.
4. Edit through the sandboxed CLI. After each editing call the host automatically runs
   registered checks in the same sandbox, with their host-configured executable and arguments.
5. Accept the result only when reported snapshots and change references match
   actual files, no unresolved items remain, and all registered checks passed on
   the current permitted files. Every edit invalidates earlier checks.

The model returns JSON actions, which Kushibot's `AgentActionParser` processes.
The only bound tool is `cli`, in both phases:

```json
{
  "kind": "tool",
  "toolId": "cli",
  "arguments": { "command": "rg -n greeting . && cat greeting.txt" }
}
```

Commands use `/bin/sh -c` with `/workspace` as their working directory. The result includes
`exitCode`, bounded `output`, `truncated`, `timedOut`, registered check results, and an
`EditingResult` under `status`. Use `{"command":"true"}` to refresh that status. Copy its
references into the final editing result. Arbitrary verification commands can also be run
through the CLI; registered checks remain host-owned requirements.

Each run works directly in the supplied workspace. Planning reads it, and editing writes changes there immediately; no per-run project copy is created or returned in the artifacts. Restricted tasks still use temporary projections of their allowed files and apply permitted changes back to the supplied workspace.

The CLI requires **Linux with Bubblewrap** and unprivileged user namespaces. On macOS or
Windows, run the Kushex backend in Docker. The supplied image installs Bubblewrap and
ripgrep; Compose applies `docker/cli-seccomp.json`. Unsupported systems and blocked
namespace creation fail without running an unconfined shell.

The sandbox exposes read-only system executables/libraries, an isolated `/tmp`, a minimal
`/dev`, and the supplied workspace (or allowed-file projection). `/proc` is empty. It starts with an empty environment plus
`PATH`, `HOME`, `TMPDIR`, and `LANG`; backend credentials, authentication mounts, source
mounts and network interfaces are not exposed. Processes run in separate PID, mount,
user, IPC, UTS, network and cgroup namespaces, with capabilities dropped. Background
descendants die when the CLI invocation ends. Root `node_modules` is mounted read-only.

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

The plugin composes three responsibilities:

- `CliTool` implements Kushibot's `ITool`, validates commands, invokes the sandbox,
  runs registered checks, and returns output plus change evidence.
- `SandboxedCli` owns Bubblewrap configuration, environment isolation, process cleanup,
  output bounds, cancellation, and deadlines.
- `CliWorkspace` fingerprints original workspace files and discovers additions, edits,
  and deletions after CLI calls. Restricted tasks use temporary copies containing only
  permitted files. Unauthorized additions are rejected before any projected files are
  copied back; temporary projections are removed after each call.
- Kushibot’s `WorkspaceEvidence` owns tracked baselines, snapshot/change references, and
  check results used to verify completion. It stores change payloads through Kushibot
  and retains only their references locally.
- Kushibot’s `InMemoryToolOperationJournal` implements Kushibot's `IToolOperationJournal`:
  completed operations replay their receipts; pending operations are not repeated.
  Receipts are isolated per run and do not survive process restarts.

Planning and editing use separate CLI registrations: the former mounts the workspace
read-only and the latter enables workspace writes. Unavailable tools return
`TOOL_NOT_AVAILABLE`; malformed arguments return `TOOL_ARGUMENTS_INVALID`.
Recoverable workspace errors remain observations so the model can correct them.
If an operation times out before its result is known, Kushibot may return a pending
run requiring reconciliation, even after cancellation has been sent to the process.

## Scope and limits

- Empty `filePaths` (or no chat attachments) enables reads and writes throughout
  the workspace, including new files. Nonempty `filePaths` is an explicit allowlist
  for both reads and writes, up to 16 files.
  Include relevant project instructions and test files. Restricted tasks cannot see
  other project files or dependencies. Additions and deletions are supported.
- Reviewed files must be regular UTF-8 text files up to 64 KiB, with safe relative
  paths and no symbolic/hard links. Unchanged binary and oversized files are fingerprinted
  but cannot be modified or deleted in an accepted result. Root `node_modules` and `.git`
  are excluded from change review. Workspaces are limited to 10,000 files outside those
  exclusions, and accepted changes to 16 files. Each model action is limited to 16 KiB by Kushibot.
  This runner suits small, bounded changes. External `sourceRefs` are rejected;
  supply context through permitted files.
- Registered checks have the same filesystem and network restrictions as model commands.
  Checks that require external services, host paths, or unavailable system executables fail.
  Register relevant checks: with `checks: []`, completion validates change evidence but does not
  independently prove the task's semantic acceptance criteria.
- Default limits: 30 turns per session, 10-minute run deadline, 60-second
  model timeout, a 45-second limit per CLI/check process and 60-second bound for the
  complete tool call, 120 model calls/iterations, and 100 tool calls across the
  run. Token limits are shared across phases and configurable through `limits`.
- One run at a time per instance; each subsequent run receives fresh state.
  The default workflow stores are in memory, with no process-restart recovery.
  Change artifacts use the configured writer; local chat persists them in SQLite.
  Supply a Kushibot `IAgentRunStoreFactory` through `stores` to use host storage adapters. Changes
  remain in the supplied workspace on failure/cancellation; no automatic rollback,
  commit, push, or publication occurs.
- In project chat, completed coding runs with changes prepare durable proposals.
  **Review changes** opens the recorded versions in Monaco. The agent has already
  written these changes to the workspace; proposal application is not needed to persist them.
  Uncertain outcomes remain pending and can be reconciled without repeating writes.
  Reopening a saved chat restores the proposal and its publication state.

## Validation

From `kushex`:

```sh
pnpm typecheck:agent:coding
pnpm test:agent:coding
```

The integration tests require Linux with Bubblewrap and permitted user namespaces.
On macOS/Windows, or to verify the exact container security profile:

```sh
pnpm test:agent:coding:container
```

This builds a dedicated test image and runs the integration suite with the sandbox
profile, then a fail-closed test with Docker's default restrictions. Tests use scripted
gateways, real isolated commands, and temporary workspaces. No paid model calls occur.

The creation API changed from `new CodingAgent(options)` to
`createCodingAgent(options)` with Codex CLI or an injected test gateway. Execution controls moved from
task fields to the second argument of `run(task, { signal, onProgress })`.
