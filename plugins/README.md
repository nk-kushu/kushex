# Agent plugins

Each subdirectory here is an independent plugin package with its own
`kushex-plugin.json`. The bundled coding plugin lives in `coding/`:

```text
plugins/
  coding/
    package.json
    kushex-plugin.json
    agent.ts
    prompts/
```

The server discovers packages in `KUSHEX_PLUGINS_DIR` (default: this directory).
There is no special Local Agents plugin, automatic folder migration, or panel
agent creation. Add agents explicitly to a package manifest, then restart Kushex.
The coding plugin contributes the stable agent ID `coding`, keeping
`/agents/coding`, saved chat selections, notes and breakpoints intact.

Open **Plugins** to browse packages and **Agents** to edit their contributed source
files. Every text file can be edited and saved, and new files and subfolders can
be added within an installed agent. Hidden files and symlinks are not shown;
binary files and files over 512 KB are listed but cannot be edited. Saves check
each file's revision and reject stale content rather than overwriting newer edits.

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

Agents run with the server's environment (minus its database settings).
Plugins using OpenAI HTTP can read `OPENAI_API_KEY` and `OPENAI_MODEL`.
Each plugin's `package.json` marks its sources as ES modules.
`import ... from "kushibot"` resolves to `KUSHEX_KUSHIBOT_DIR`. Runs live in server
memory; the project workspace must be writable for accepted coding changes.

## Local plugins

Kushex discovers `kushex-plugin.json` packages at startup from
`KUSHEX_PLUGINS_DIR`, an absolute directory path (default: `kushex/plugins`).
Install a package by copying its complete folder into that directory, then restart
the server. Remove its folder and restart to uninstall. IDs must be unique across
all plugins. History, saved selections, notes and breakpoints remain associated
with the agent ID and resolve again when that ID is reinstalled.

```text
plugins/example/kushex-plugin.json
plugins/example/agents/echo/main.ts
```

```json
{
  "id": "example",
  "name": "Example Agents",
  "version": "1.0.0",
  "apiVersion": 1,
  "agents": [
    {
      "id": "echo",
      "name": "Echo",
      "description": "Repeat a message.",
      "directory": "agents/echo",
      "entry": "main.ts"
    }
  ]
}
```

```ts
export async function chat({ message }: { message: string }) {
  return message;
}
```

Open **Plugins** to inspect packages and errors or open an agent in the existing
editor. Agent files are edited in place, including external plugin files. New runs
load the saved entry. Read-only packages remain viewable; saves require write
access. Entries and imports should be regular files inside the agent directory;
the editor does not follow symbolic links. Use a `package.json` with `"type":
"module"` in the plugin folder for ES module sources.

Agents run as local trusted code with the existing Node/tsx runner, project working
directory, cancellation and debugger. TypeScript and Node built-ins are supported.
The configured `KUSHEX_KUSHIBOT_DIR` provides the `kushibot` runtime import and
editor types even outside the repository. Install any other dependencies manually
in the plugin package (`node_modules`), using normal Node resolution; Kushex does
not install dependencies or expose their types in the editor. Plugins contribute
agents only; there are no plugin pages, services, tools or lifecycle hooks.

Standalone Docker mounts this directory at `/plugins` and sets
`KUSHEX_PLUGINS_DIR=/plugins`. For another location, update the mount and environment
variable together. Mount packages writable to save edits through the editor.
