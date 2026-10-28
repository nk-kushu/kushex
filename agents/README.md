# Agents

Agents created in the Kushex panel (**Agents** activity) are stored here, one
folder per agent:

```
agents/
  code-reviewer/
    agent.ts            # primary file: `export default agent`
    prompts/review.ts   # any other files the agent needs
```

The primary file is written against [kushibot](../../kushibot) and starts from a
template that defines the agent's instructions, model profile and run
configuration, exported together as the default export. The panel shows the
whole folder as a tree: every text file can be edited and saved, new files and
subfolders can be added, and imports between the agent's files are type-checked.
Hidden files (names starting with a dot) and symlinks are not shown; binary files
and files over 512 KB are listed but cannot be edited.

The server reads and writes this directory (`KUSHEX_AGENTS_DIR`, default: this
folder). Saving from the panel is revision-checked: if the file changed after you
opened it, the save is rejected instead of overwriting the newer version. Each
file is checked on its own. Files
can also be edited here directly; reopen the agent in the panel afterwards.

## Running and debugging from the chat

Open a project, pick an agent in its chat panel and send a message. Each message is one run of the agent's primary file in
its own Node process, with the project checkout as working directory. **Start debugging**
enables debugging for every message sent in that project until **Stop debugging** is
clicked. Send (or Ctrl/⌘+Enter) then starts each run under the debugger:
breakpoints set in the **Agents** editor's gutter
bind before the agent's code runs. When the run pauses, the chat links to the agent
editor (**Open debugger**), which follows the paused line, with Variables, Watch,
Call stack, Breakpoints and a Debug console below it (F5 continue, F10 step over, F11
step into, Shift+F11 step out, Shift+F5 stop). Stepping into kushibot shows its compiled
JavaScript read-only.
Stopping debugging also cancels the current debug run. Finish or stop an active
debug run before sending the next message. The debugging mode is remembered per project.

The editor and project chat can be in separate browser tabs. Tabs with the same
panel instance and API endpoint share breakpoints and the active debug session;
each tab streams the session's pause and resume events independently. Debug also
reads the latest saved breakpoints before launching, so background-tab delays do
not omit newly set breakpoints.

To run from the chat, the primary file exports `chat`:

```ts
export async function chat(request: {
  message: string;
  /** Workspace-relative files attached to the message. */
  files: readonly string[];
  /** Absolute path of the project checkout. */
  workspace: string;
  signal: AbortSignal; // aborted when the run is stopped
  progress(message: string): void; // shown as steps in the chat
  /** kushibot's IScopedDebugRecorderFactory; absent when kushibot is not configured. */
  debug?: IScopedDebugRecorderFactory;
}): Promise<unknown>; // a string is shown as text, anything else as JSON
```

### Debug events

Pass `request.debug` as the `debug` option of kushibot's `AgentRuntimeFactory` (the
coding agent does) and each run records kushibot debug events: the agent run, workflow
steps, model calls with token usage, tool calls and progress messages, each with its
duration and outcome. Agents that call a gateway directly can wrap it in
`DebugRecordingModelGateway`, or record their own with `request.debug.create(...)`.
The runner sends the events to the server, which validates them and stores them through
kushibot's `SqlDebugEventStore` in PostgreSQL (schema `kushibot`). The **Debug events**
button on each run in the chat opens its timeline at
`/projects/<project>/runs/<run>/debug-events`; it updates while the run works and still
opens after a server restart. `KUSHIBOT_LOG_ENABLED=false` turns recording off and
`KUSHIBOT_LOG_LEVEL` (default `debug`) sets the lowest level recorded.

The coding agent's `chat` uses Kushibot's Codex CLI adapter and saved `auth.json`.
It reads `CODEX_MODEL`, `CODEX_HOME`, and optional `CODEX_EXECUTABLE` from the server.
See [coding agent setup](coding/README.md#run-with-codex-cli).

New agents get a `chat` that makes one OpenAI HTTP model call with their instructions.
Agents run with the server's environment (minus its database settings), so these
templates use `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. `package.json` here marks agent sources
as ES modules; without it they run as CommonJS and step badly through generated code.
`import ... from "kushibot"` resolves to `KUSHEX_KUSHIBOT_DIR`. Runs live in server
memory only, and the project workspace is mounted read-only in Docker, so agents that
write files (such as coding) fail at their first write there.
