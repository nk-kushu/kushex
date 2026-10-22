# Kushex

Harness panel for [kushibot](../kushibot). Currently a single page showing the
Kushex title. Design docs for the full panel: [docs/](docs/README.md).

```sh
pnpm install
pnpm dev              # standalone panel on :5173
pnpm test             # vitest in every package
pnpm typecheck && pnpm lint
pnpm build            # @kushex/ui (ESM + style.css + .d.ts), @kushex/embed (ESM + IIFE), standalone
```

| Package           | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `packages/ui`     | `<KushexPanel />`: theme, store, the title page             |
| `packages/embed`  | `mountKushex(el, options)` for non-React hosts (Shadow DOM) |
| `apps/standalone` | Full-page Vite app                                          |

## Docker

Start the frontend, compiled backend, and PostgreSQL:

```sh
docker compose -f docker/compose.standalone.yml up --build -d
```

Open <http://localhost:3050>. The backend health endpoint is available at
<http://localhost:3050/api/health>. The backend and PostgreSQL use the internal
Docker network; only the frontend publishes a host port.
Frontend API calls should use relative `/api/...` URLs; both Nginx and Vite forward
these to the backend and remove the `/api` prefix.

For development with Vite HMR and the backend TypeScript watcher:

```sh
docker compose -f docker/compose.standalone.yml -f docker/compose.dev.yml up --build
```

The frontend remains on port **3050**. Frontend and shared UI source edits use
Vite HMR; backend source edits restart the server through `tsx watch`. Dependencies
stay inside the image, separate from host `node_modules`. Rebuild after changing
package manifests, the lockfile, or files outside the mounted source/config paths.
Use the same Compose flags when stopping a mode or reading its logs.

PostgreSQL 18 stores data in the `postgres-data` named volume and is reachable
inside Compose at `postgres:5432`. The backend receives
`DATABASE_URL=postgresql://kushex:kushex_local@postgres:5432/kushex`.
The starter does not yet include a database client, queries, or migrations.
The default credentials are for local use; set `POSTGRES_PASSWORD` before startup
to override the password (use a URL-safe value for the connection URL).
Changing the variable does not change the password of an already initialized database.

Open a database shell:

```sh
docker compose -f docker/compose.standalone.yml exec postgres psql -U kushex -d kushex
```

Stop the compiled stack while keeping database data:

```sh
docker compose -f docker/compose.standalone.yml down
```

Add `-f docker/compose.dev.yml` when stopping development mode. Both modes share
the same project and database volume; run one mode at a time.
