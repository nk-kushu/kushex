# 03 — Implementation order

Status: **proposal**. Deliver vertical features with their HTTP contract,
application/domain classes, persistence, and observable validation together.
The folder structure is a target, not a request to scaffold all modules at once.

## 1. Application foundation

Status: **implemented**. See [04-foundation.md](04-foundation.md) for the decisions and contracts.

- Refactor the procedural starter into `Application`, configuration, HTTP lifecycle,
  and a composition root, following the backend OOP skill.
- Select routing/validation and PostgreSQL/migration tooling. Add a database adapter,
  explicit migration command, transaction boundary, and consistent API errors.
- Keep liveness separate from database readiness; preserve a documented health
  contract and align Compose probes with it.
- Decide the initial actor/authentication model and workspace provisioning before
  enabling repository access or coding actions. Document local deployment assumptions.

**Done when:** the server boots against Compose PostgreSQL, applies migrations
through an explicit command, handles configuration/connection errors predictably,
and closes its resources cleanly. Typecheck, build, and database/HTTP integration
checks pass.

## 2. Persistent projects and workspace reads

- Implement project creation/list/detail and stable IDs; add workspace metadata
  and an explicit allowed root or managed checkout location.
- Add workspace tree, bounded file reads, and branch/revision information through
  injected filesystem/Git contracts. Reject paths escaping the authorized root.
- Define browser-safe API DTOs. Wire project selection and file browsing to server
  data; remove fixture assumptions as those screens are connected.
- Extend Docker with deliberate coding workspace mounts/storage. Keep these separate
  from the existing mounts used to edit Kushex itself.

**Done when:** a project survives restart, file browsing reads its authorized
workspace, and invalid paths/project access fail through tested public APIs.

## 3. Durable chat and execution lifecycle

- Add threads, paginated message history, and context references scoped to a
  project/workspace. Start with plain messages, then file/note/task context as
  those modules become available.
- Verify the chosen agent runtime and implement its adapter behind `AgentRuntime`.
  Define execution transitions and same-thread concurrency policy explicitly.
- Persist message, execution request, and command receipt atomically. Add a
  dispatcher that claims work and records normalized runtime events.
- Add authenticated/scoped SSE with replay, heartbeats, bounded buffers, and
  cancellation. Update proxy buffering/timeouts when implementing streaming.
- Reconcile interrupted runs on startup. Exercise restart and retry behavior;
  do not equate a disconnected browser with execution cancellation.

**Done when:** a real message produces streamed agent output and durable history;
retrying submission does not start duplicate work, reconnect replays events,
and restart exposes a truthful interrupted/recovered state. Validate orchestration
with a deterministic runtime double and the adapter against its actual runtime.

## 4. Reviewable coding changes

- Run coding edits in an isolated execution workspace and record reviewable patches
  with base revisions. Persist enough data to render before/after after restart.
- Connect changes cards, diff tabs, and Accept/Reject to proposal commands with
  command identity and base-revision validation.
- Make application of external filesystem changes recoverable: record intent,
  detect partial application/failure, and reconcile instead of claiming that a
  database rollback can undo filesystem writes.
- Feed execution output and diagnostics into the existing bottom panel.

**Done when:** generated edits are reviewable without modifying the reviewed
workspace prematurely; accepting applies the reviewed revision once, rejecting
leaves it untouched, and stale bases produce a conflict. Cover failure recovery.

## 5. Project tasks and agent handoff

- Persist the current board states, descriptions, tags, assignee references,
  relationships, and append-only activity records.
- Implement versioned task updates and a task-to-agent application service that
  creates/links a thread and requests an execution through existing contracts.
- Replace board/list/detail fixtures. Keep task status separate from execution
  status and record user decisions in task activity.

**Done when:** tasks persist, board and detail agree, conflicting updates are
reported, and “Start with agent” opens traceable work without duplicate executions.

## 6. Notes and scoped configuration

- Persist Markdown notes, pinning, search, and revisions; connect editor saves with
  conflict handling and use note IDs in chat context.
- Define actual project/agent settings rather than persisting the placeholder
  fields. Keep credentials in server configuration or a secret store and expose
  only non-secret settings/references.
- Color mode and density now persist per actor through `GET/PATCH /settings`.
  Retain open tabs and panel layout as client preferences unless synchronization
  is explicitly requested.

**Done when:** notes survive restart, stale saves cannot silently overwrite newer
content, and execution configuration is server-resolved without returning secrets.

## Later decisions

Detailed database schema, API/event specification, agent runtime integration,
workspace execution isolation, and authentication deserve follow-up documents
before their phases begin. A separate worker, multi-user collaboration, terminal
sessions, and advanced run/usage dashboards can be added when their requirements
are defined; the initial structure should not create those systems speculatively.
