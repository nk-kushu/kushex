# 05 — Projects and workspaces

Status: **implemented** (phase 2 of the [implementation plan](03-implementation-plan.md)).

## Ownership

A Project is durable app data: ID, local actor, name, description, creation time. Its
Workspace is a separate persisted pointer to an existing checkout. A unique
`Workspace.projectId` enforces one workspace per project; removing that constraint
later can support worktrees or multiple repositories. Branch and revision are
nullable placeholders; this phase reads no Git metadata.

Deleting or moving a checkout leaves the Project intact. Filesystem requests then
return `NOT_FOUND`; the application does not delete the project or cache disk data.
File tabs, selection, expanded directories and activity remain client state. The
server has no open-file state.

Kushibot's isolated edit workspace is unrelated and is not implemented here.

## Deployment and containment

`KUSHEX_WORKSPACES_ROOT` is a comma-separated list of absolute roots; together they
form the deployment boundary. Root basenames must be unique, because a workspace row
stores `<root basename>/<directory>` (for example `PersonalProjects/KushiBox`).
`GET /locations` lists the immediate subdirectories of every root in configuration
order, and a root itself cannot become a project. Requests carry paths relative to
that workspace. A checkout must stay inside its own root. The local
adapter resolves both with `realpath` on every request. It rejects absolute paths,
parent traversal, Windows-style paths, NULs, and symlinks escaping either boundary.
Symlinks within the checkout can be read. Escaping and broken links are omitted
from listings. Ordinary files and directories only are exposed.

Compose mounts `${KUSHEX_WORKSPACES_HOST_ROOT:-../workspaces}` at `/workspaces`,
read only, separately from Kushex's development source mounts. Relative host mount
paths resolve from `docker/compose.standalone.yml`. The default is the repository's
empty `workspaces/` folder. Set `KUSHEX_WORKSPACES_HOST_ROOT` to an existing absolute
host directory to browse real checkouts:

```sh
export KUSHEX_WORKSPACES_HOST_ROOT=/Users/niki/projects
docker compose -f docker/compose.standalone.yml up --build
```

The mount makes host files reachable; the resolver limits each project to its own
checkout. A link from one checkout into a sibling is forbidden even when both are
mounted. For several host roots, add a gitignored `docker/compose.local.yml` override that
binds each one under `/roots/<name>` and sets
`KUSHEX_WORKSPACES_ROOT=/roots/PersonalProjects,/roots/projects`. Native development
uses the same adapter; set
`KUSHEX_WORKSPACES_ROOT=/Users/niki/PersonalProjects,/Users/niki/projects` before
starting the server.
The native default is `workspaces` relative to the server's working directory.

This is a local-operator tool over trusted local checkouts. The adapter rechecks
opened file identity and caps actual bytes read. Node's portable path APIs do not
provide a kernel-enforced sandbox against a hostile local process concurrently
renaming parent directories; deployment isolation remains the outer boundary.

## HTTP contract

Routes below are on the backend; the frontend proxy adds `/api`.

| Route | Response |
| --- | --- |
| `GET /locations?offset=0` | Immediate subdirectories of every root, root-prefixed, `{ entries, nextOffset }` |
| `POST /projects` | `{ name, path, description? }` → `201 ProjectDto` |
| `GET /projects?offset=0` | `{ entries: ProjectDto[], nextOffset }`, 100 projects per page |
| `GET /projects/:id` | Selected project metadata, including workspace |
| `GET /projects/:id/tree?path=&offset=0` | One directory's `{ entries, nextOffset }` |
| `GET /projects/:id/file?path=src/index.ts` | `{ path, size, kind: "text", content }` or `{ path, size, kind: "binary" }` |

Project creation validates the checkout before an atomic nested Prisma create.
Project and Workspace rows are committed together in the `kushex` schema. The
migration is an explicit deployment step, never a request side effect.

The tree lists at most **500** visible immediate entries per page using a streaming
directory iterator. `.git`, `node_modules`, and `dist` are excluded by a fixed
server-side list and cannot be read directly. Pagination uses offsets in filesystem
iteration order, not a snapshot: concurrent changes can shift pages. Refresh the
tree after disk changes. No recursive traversal, watching, or server tree cache.

File reads are bounded to **1 MiB**, including files that grow after opening.
Only valid UTF-8 without NUL bytes is shown as text; other encodings and binary data
return `kind: "binary"`. Oversized files return `413 PAYLOAD_TOO_LARGE` with
`details: [{ size, maxBytes }]`, without reading or returning the full content.
Empty text files are valid. Non-regular files are not readable.

All projections use `Cache-Control: no-store`. Shared browser-safe DTOs live in
`@kushex/contracts`; no backend runtime code is imported into the UI.

## Actor and transport access

`RequestContextFactory` obtains the fixed `local-operator` actor through the
`ActorResolver` port. Services receive the context explicitly; repositories scope
project and workspace lookups by actor. Workspace resolution produces the future
scope keys `project_id` and `workspace_key` without a Kushibot dependency.

`LocalRequestGuard` checks Host and browser Origin before handlers run. Expected
hosts are loopback names plus the hostnames explicitly configured in
`KUSHEX_ALLOWED_ORIGINS`. Origins must match exactly, including scheme and port.
Native clients may omit Origin. Cross-site browser mutations are rejected, and
mutations require `application/json`.

Native defaults allow localhost and 127.0.0.1 on ports 5173 and 3050. Compose allows
port 3050 only. Set `KUSHEX_ALLOWED_ORIGINS` to a comma-separated list if changing
the local frontend origin. Proxies preserve the original Host and Origin. This
is not authentication; exposing the service beyond the local operator or embedding
on another origin still requires an authentication phase.

Application errors map to `403 FORBIDDEN`, `404 NOT_FOUND`, and
`413 PAYLOAD_TOO_LARGE`. Raw filesystem exceptions and absolute paths are not
returned. Unknown failures remain `500 INTERNAL_ERROR` and are logged.

## Browser behavior and validation

Projects load from RTK Query. New project opens a location picker, saves a project,
and switches to its files. Selecting a different project clears tabs. The project
selector and status bar use persisted IDs and metadata; no fabricated branch or
connection status is shown.

The tree loads directories on expansion and offers Load more entries for pages.
Refresh files discards the expanded projection and rereads the root. Selecting a
file opens a read-only CodeMirror viewer, loaded in a separate chunk, with UTF-8
text highlighting for JavaScript/TypeScript, JSON, and Markdown. Binary, oversized,
missing, and inaccessible files have explicit states. Refresh file rereads disk.
No write, accept/apply, or file-watch endpoint is added.

Tests cover traversal, symlinks at both boundaries, stale roots, ignore rules,
pagination, text/binary/size verdicts, HTTP validation and request guards, actor
scope, real PostgreSQL migration/unique constraints/rollback, and the browser flow
through the actual RTK Query middleware. No production database is needed for the
filesystem or HTTP fixture tests.
