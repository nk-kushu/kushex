# Kushex server

Minimal Node.js and TypeScript HTTP server with no runtime dependencies.
Requires Node.js 22.18 or newer; development uses native TypeScript support.

Run from the repository root:

```sh
pnpm install
pnpm --filter @kushex/server dev
```

`GET /health` returns `{"status":"ok"}` at `http://127.0.0.1:3000`.
Unknown routes return JSON 404 responses. Set `HOST` and `PORT` to configure
listening, for example `HOST=0.0.0.0 PORT=4000 pnpm --filter @kushex/server dev`.

Build and run compiled JavaScript:

```sh
pnpm --filter @kushex/server typecheck
pnpm --filter @kushex/server build
pnpm --filter @kushex/server start
```

SIGINT and SIGTERM allow up to ten seconds for active requests to finish.
