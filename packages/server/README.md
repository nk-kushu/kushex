# Kushex server

Node.js/TypeScript backend: Fastify HTTP, Zod validation, and Prisma (Client via
`@prisma/adapter-pg`, Migrate as an explicit step) on PostgreSQL. Requires Node.js 22.18 or newer. Design and
contracts: [backend foundation](../../docs/backend/04-foundation.md). Follow the
[backend OOP skill](../../.agents/skills/backend-oop/SKILL.md) when changing code.

## Run locally

The server needs PostgreSQL. The simplest option is the Docker stack (see the
repository README). To run it on the host against your own database:

```sh
pnpm install
export KUSHEX_WORKSPACES_ROOT=/absolute/path/to/checkouts
export DATABASE_URL=postgresql://kushex:kushex_local@127.0.0.1:5432/kushex
pnpm --filter @kushex/server migrate   # prisma migrate deploy (explicit step)
pnpm --filter @kushex/server dev       # prisma generate, then tsx watch on :3000
```

Startup exits with code 1 and a clear message when configuration is invalid or the
database is unreachable. SIGINT/SIGTERM drain requests for up to
`SHUTDOWN_TIMEOUT_MS`, then close HTTP and database connections. Environment
variables are listed in the [foundation doc](../../docs/backend/04-foundation.md#configuration).

| Endpoint            | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `GET /health`       | Liveness, `{"status":"ok"}`                                           |
| `GET /health/ready` | Readiness: database reachable and migrations current; `503` otherwise |

Errors use `{ "code", "message", "details"? }` bodies.

Projects and read-only browsing: `GET /locations`, `POST /projects`,
`GET /projects`, `GET /projects/:id`, `GET /projects/:id/tree?path=`, and
`GET /projects/:id/file?path=`. See [projects and workspaces](../../docs/backend/05-projects-and-workspaces.md)
for DTOs, pagination, preview limits, containment, and Origin/Host configuration.

## Prisma and migrations

Kushex tables live in the PostgreSQL schema `kushex` (`prisma.config.ts` adds it to
`DATABASE_URL`). The client is generated into `src/generated/prisma` (gitignored).

```sh
pnpm --filter @kushex/server generate                       # prisma generate
pnpm --filter @kushex/server migrate:create --name <change> # write a migration from schema.prisma
pnpm --filter @kushex/server migrate                        # prisma migrate deploy
pnpm --filter @kushex/server migrate:status                 # prisma migrate status
```

The server never migrates on its own; `/health/ready` reports pending, failed or
edited migrations until `migrate` runs. Never edit an applied migration.

## Build and check

```sh
pnpm --filter @kushex/server typecheck   # src and tests
pnpm --filter @kushex/server test        # unit tests, no database needed
pnpm --filter @kushex/server build       # emits dist/ (tests excluded)
pnpm --filter @kushex/server start       # node dist/index.js
```

## Integration tests

Integration tests (`tests/integration`) create and drop a uniquely named database
per test and run the real `prisma migrate deploy` against temporary migration folders, so they need a **disposable** PostgreSQL server whose user can create
databases:

```sh
docker run -d --rm --name kushex-test-pg -e POSTGRES_USER=kushex \
  -e POSTGRES_PASSWORD=kushex_test -p 127.0.0.1:55432:5432 postgres:18-bookworm
KUSHEX_TEST_DATABASE_URL=postgresql://kushex:kushex_test@127.0.0.1:55432/postgres \
  pnpm --filter @kushex/server test:integration
docker stop kushex-test-pg
```

They fail with a clear message when `KUSHEX_TEST_DATABASE_URL` is unset.
