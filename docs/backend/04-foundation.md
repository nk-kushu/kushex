# 04 — Application foundation

Status: **implemented** (phase 1 of the [implementation plan](03-implementation-plan.md)).
Records the decisions behind the server foundation and the contracts later phases
build on. Actor and workspace sections are decisions for phases 2–4; they are not
implemented yet.

## Tooling

| Concern            | Choice                                                             | Why                                                                                                            |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| HTTP and routing   | Fastify 5                                                          | Mature lifecycle (`close`, in-flight draining), request IDs, raw response access for SSE later                 |
| Request validation | Zod 4, as Fastify route schemas                                    | One schema language for config, requests and future `packages/contracts` DTOs; parsed values replace raw input |
| Data access        | Prisma ORM 7 (`prisma-client` generator) with `@prisma/adapter-pg` | Typed client for Kushex tables over node-postgres, the driver Kushibot's PostgreSQL acceptance suite uses      |
| Migrations         | Prisma Migrate (`prisma migrate deploy`)                           | Schema in `prisma/schema.prisma`, SQL migrations generated and tracked by Prisma                               |
| Logging            | pino (Fastify's logger), JSON to stdout                            | Structured logs; consumers depend on the narrow `Logger` contract                                              |
| Tests              | Vitest                                                             | Same runner as the frontend packages                                                                           |

## Startup, shutdown and composition

- `src/index.ts` only hands the server to `ProcessHost`. It loads configuration, turns `SIGINT`/`SIGTERM` into a stop
  request, logs failures and sets a non-zero exit code. A second signal exits at once.
- `ApplicationFactory` is the composition root. `Application` owns `ManagedResource`s
  (currently the database, then HTTP), starts them in order, and stops them in reverse.
  A failed start stops whatever already started.
- Shutdown has one deadline (`SHUTDOWN_TIMEOUT_MS`, default 10 s). HTTP stops
  accepting connections and drains in-flight requests; at the deadline it closes the
  remaining connections. If a resource still does not finish 2 s later, the
  process exits with code 1. Compose's 15 s `stop_grace_period` covers this.
- Startup fails fast with exit code 1 on invalid configuration (all problems listed,
  no secrets echoed) or an unreachable/unauthenticated database
  (`Could not connect to PostgreSQL at host:port/db: reason`). There is no retry loop;
  Compose orders startup by health and migration completion.

## Database boundary

- `PrismaDatabase` owns the `PrismaClient` and its node-postgres pool as a
  `ManagedResource`. Startup runs `SELECT 1`; shutdown calls `$disconnect()`, which
  closes the pool.
- Kushex tables live in the PostgreSQL schema **`kushex`**. Generated queries are
  qualified with it, and the pool's `search_path` is `kushex`. Kushibot's `kushibot_*`
  tables stay in `public`, so Prisma's drift detection never sees them.
- Repositories take the `PrismaClient` (or a `Prisma.TransactionClient` inside
  `client.$transaction(async (tx) => ...)`) through their constructor. Operations
  that must commit together share one interactive transaction. Never hold a
  transaction open across agent calls or filesystem effects.
- The generated client goes to `src/generated/prisma` (gitignored). `dev`, `build`,
  `typecheck` and `test:integration` run `prisma generate` first.
- Kushibot's SQL stores need an `ISqlDatabase` binding (raw SQL, pinned
  transactions, advisory-locked migrations). It will be added with the Kushibot
  dependency (phase 3), over the same database. Prisma Client does not expose that
  contract.

## Migrations

Migrations are an explicit deployment step, never run by the server or request handlers.

- Change `prisma/schema.prisma`, then create a migration with
  `pnpm --filter @kushex/server migrate:create --name <change>`
  (`prisma migrate dev --create-only`). Review the generated SQL and commit it. In
  Docker dev mode, run it inside the backend container (see below). It needs a
  database user that can create Prisma's temporary shadow database.
- `migrate` (`prisma migrate deploy`) applies pending migrations and records them in
  `kushex._prisma_migrations`. Never edit an applied migration; add a new one.
- Readiness compares `prisma/migrations` with `_prisma_migrations` directly; it does
  not run the CLI. Pending, failed, edited (checksum mismatch), or unknown applied
  migrations make it fail. A failed migration needs `prisma migrate resolve`.
- The production image includes the `prisma` CLI, `prisma/` and `prisma.config.ts`,
  because the `migrate` service runs from the backend image.
- No application models exist yet; the first migration arrives with projects (phase 2).

## Health contract

| Route               | Meaning                                                            | Response                                                                               |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /health`       | Liveness: the process serves HTTP. Never checks dependencies       | `200 {"status":"ok"}`                                                                  |
| `GET /health/ready` | Readiness: database reachable and no pending or drifted migrations | `200 {"status":"ready","checks":{...}}` or `503 {"status":"not_ready","checks":{...}}` |

Each check is reported as `{"ready":true}` or `{"ready":false,"reason":"..."}`.
Checks run concurrently with a 2 s timeout, and unexpected errors are logged
without being exposed. Both routes send `Cache-Control: no-store`, support `HEAD`,
and return `405` with `Allow: GET, HEAD` for other methods. Through the proxy, they
are `/api/health` and `/api/health/ready`.

The Compose backend healthcheck uses **readiness**, which gates the frontend's
`depends_on`. An orchestrator with separate probes should use `/health` for
liveness, so a database outage does not restart a healthy process.

## Error contract

Every error response is JSON `{ "code": string, "message": string, "details"?: [] }`,
and every response carries an `X-Request-Id` header (a generated UUID).

| Status          | `code`                                                       | When                                                                       |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 400             | `VALIDATION_FAILED`                                          | A Zod route schema rejected input; `details` lists `{ path, message }`     |
| 400 / 413 / 415 | `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Malformed JSON, body limits, media types                                   |
| 404             | `NOT_FOUND`                                                  | Unknown route                                                              |
| 405             | `METHOD_NOT_ALLOWED`                                         | Includes an `Allow` header                                                 |
| 500             | `INTERNAL_ERROR`                                             | Unexpected failure; details are logged with the request ID, never returned |

Feature errors (not found, conflict, forbidden) are added to `ErrorResponder` with
the first feature that raises them, mapping application errors to these codes.

## Configuration

| Variable                      | Default              | Notes                                               |
| ----------------------------- | -------------------- | --------------------------------------------------- |
| `DATABASE_URL`                | required             | `postgres://` or `postgresql://` URL                |
| `HOST` / `PORT`               | `127.0.0.1` / `3000` | Compose sets `0.0.0.0` inside the container network |
| `DATABASE_POOL_MAX`           | `10`                 | 1–100                                               |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000`               | Connection acquisition timeout                      |
| `SHUTDOWN_TIMEOUT_MS`         | `10000`              | Drain deadline before connections are closed        |
| `LOG_LEVEL`                   | `info`               | pino levels or `silent`                             |

Blank values count as unset.

## Actor and authentication model (decision)

The initial deployment model is **one local operator on a single machine**:

- There is no login. Every request acts as one fixed actor, the _local operator_.
  The trust boundary is the host. Compose publishes only the frontend, on
  `127.0.0.1:3050`; the backend and PostgreSQL stay on the internal network.
- With the first actor-scoped feature (phase 2), add `RequestContext` with an
  `Actor` from an `ActorResolver` interface. The first implementation,
  `LocalOperatorActorResolver`, returns the fixed operator. Services receive the
  actor explicitly, so real authentication later replaces only the resolver.
- Kushibot scope mapping: one scope for the local operator, with `project_id` set to
  the Kushex project ID and `workspace_key` to the Kushex workspace ID.
- Loopback is not a complete boundary. Any web page in the operator's browser can
  send requests to `localhost`. Before adding the first **state-changing** route,
  add a transport guard. It rejects requests whose `Origin` is not the Kushex
  origin, and requests whose `Host` is not an expected local name (this protects
  against DNS rebinding). Mutating routes accept only `application/json`.
- An Accept decision is the operator's action, recorded with this actor. That is
  enough for single-operator review. It is not multi-user approval.
- Exposing Kushex beyond loopback, multi-user use, or embedding in a host on another
  origin all require real authentication first (see "Later decisions" in the plan).

## Workspace provisioning (decision)

- Kushex **registers existing checkouts**. It does not clone repositories or hold Git
  credentials initially.
- The operator mounts one host directory into the backend at a fixed container root,
  `KUSHEX_WORKSPACES_ROOT` (for example `/workspaces`). This mount is separate from
  the dev-mode mounts used to edit Kushex itself, and is added in phase 2.
- A project workspace is a relative path under that root. It is resolved with
  `realpath`, and anything resolving outside the root (`..`, absolute paths,
  symlinks) is rejected.
- Phase 2 only reads, so the mount is read-only until phase 4 applies accepted
  changes. The backend runs as the image's `node` user (uid 1000). Writable mounts
  need matching ownership, and Git may need `safe.directory` for the mount.
- Agent edits happen in Kushibot's isolated edit workspace (bounded, database-backed),
  not in the mounted checkout. Only an accepted proposal is applied to the checkout.

## Local deployment assumptions

- Docker Compose on a developer machine, one stack at a time (compiled or dev mode),
  sharing the `postgres-data` volume.
- Startup order: `postgres` healthy → `migrate` completes successfully → `backend`
  ready → `frontend`. A failed migration stops the backend from starting.
- In dev mode, `migrate` runs once on `up`. Create a migration inside the running
  backend container (the `prisma/` folder is mounted, so files appear on the host):
  `docker compose -f docker/compose.standalone.yml -f docker/compose.dev.yml exec backend pnpm --filter @kushex/server migrate:create --name <change>`.
  Apply it with `... run --rm migrate`. Until then, readiness reports it as pending.
- Default database credentials are for local use only. Model credentials, when
  added, are server-side configuration and are never returned to the browser.
