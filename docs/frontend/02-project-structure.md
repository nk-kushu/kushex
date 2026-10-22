# 02 — Project structure

## pnpm workspace packages

Kushex is a pnpm workspace. `pnpm-workspace.yaml` includes every folder under
`packages/*` and `apps/*` that has a `package.json`. These are our packages:

| Package | Folder | Kind | Published to npm | Depends on (workspace) | Status |
| --- | --- | --- | --- | --- | --- |
| `kushex` (root) | `/` | workspace root | no (`"private": true`) | — | ✅ created (lint, format, `pnpm -r` scripts) |
| `@kushex/ui` | `packages/ui` | library — the React panel | yes | — | ✅ implemented |
| `@kushex/embed` | `packages/embed` | library — `mountKushex()` for any web page | yes | `@kushex/ui` | ✅ implemented |
| `@kushex/server` | `packages/server` | library/service — HTTP + SSE API over kushibot | no (`"private": true`) | — | ❌ not created yet |
| `@kushex/standalone` | `apps/standalone` | app — full-page panel (Vite) | no (`"private": true`) | `@kushex/ui` | ✅ implemented (`dev`, `dev:mock`) |

Dependency direction (arrows point at what is imported):

```
@kushex/standalone ──► @kushex/ui ◄── @kushex/embed
        │
        └─ calls over HTTP ─► @kushex/server ──► kushibot (external)
```

- **`packages/`** holds code other packages import; **`apps/`** holds things you
  run and never import.
- Only `@kushex/ui` and `@kushex/embed` are released through Changesets; the
  others are private and are deployed via Docker instead.
- The UI and the server don't import each other. The UI only uses
  **types** from the server (`import type`); at runtime they talk over HTTP.

### External, not in the workspace

| Package | Where | Used by |
| --- | --- | --- |
| `kushibot` | `../kushibot` (separate repo, npm) | `@kushex/server` (runtime), `@kushex/ui` (`import type` only) |

Locally it can be linked from `../kushibot` instead of the published version
(see `pnpm-workspace.local.yaml`). Its name is still undecided: the package is
called `kushibot`, while the local override and these docs use
`@kushibot/core`.

Until kushibot is published, `@kushex/ui` declares it as a dev dependency,
`"@kushibot/core": "link:../../../kushibot"`, which expects the two repos as sibling
folders. Only `import type` is used in the shipped code (an ESLint rule enforces
it), and the public `.d.ts` files of `@kushex/ui` do not reference kushibot.
`lifecycle.test.ts` imports kushibot's runtime `workflowRunLifecycle` to check the
UI's copy of the transition table.

### Package names

`@kushex` is the **scope** (a shared namespace, like `@reduxjs/toolkit`); the
part after the slash is the package. The name is used for:

- **pnpm filters:** `pnpm --filter @kushex/ui test` runs only in that package.
- **Imports between packages:** `import { KushexPanel } from "@kushex/ui"`, with
  `"@kushex/ui": "workspace:*"` in the consumer's `package.json`. pnpm links it
  locally; nothing is published.
- **Publishing:** the name people install from npm. Publishing under `@kushex`
  requires owning that scope on npm (your username or an npm organization).

## `packages/ui`

Feature-sliced: each domain area owns its screens, components, slice and API
endpoints. Shared building blocks live in `shared/`.

```
packages/ui/
  package.json            name: @kushex/ui
  vite.config.ts          library mode, React + Tailwind plugins
  tsconfig.json
  src/
    index.ts              public exports: KushexPanel, KushexPanelOptions, types
    KushexPanel.tsx       root: providers (store, theme, router, App) + layout
    app/
      store.ts            makeStore(options) factory, RootState, AppDispatch
      hooks.ts            useAppDispatch, useAppSelector (typed)
      listenerMiddleware.ts
      theme.ts            antd ThemeConfig (light/dark), token → CSS var bridge
      routes.tsx          route table (shared by standalone and embed)
    api/
      baseApi.ts          createApi() with fetchBaseQuery, tag types
      liveEvents.ts       SSE connection → cache updates
    features/
      runs/               workflow runs list + run detail
        RunsPage.tsx
        RunDetailPage.tsx
        components/       RunStatusTag, RunTimeline, StepAttemptsTable ...
        runsApi.ts        injectEndpoints: listRuns, getRun, stopRun ...
        runsSlice.ts      UI-only state: filters, selected step, panel sizes
        selectors.ts
        types.ts
      sessions/           agentic sessions, sub-agents
      artifacts/          artifact browser + viewer
      usage/              usage ledger, budgets
      debug/              debug events, trace view
      publication/        change proposals, review reports, approvals
      settings/           connection, theme, preferences
    shared/
      components/         StatusTag, JsonViewer, CopyId, EmptyState, ErrorResult
      hooks/              usePolling, useLocalPreference
      lib/                formatting (durations, tokens), id helpers
      styles/
        index.css         Tailwind entry + layer order (see 03)
    test/
      renderWithProviders.tsx
      setup.ts            jsdom polyfills, MSW server, fresh mock backend per test
      msw/fixtures.ts     deterministic demo data
      msw/handlers.ts     createMockBackend(): in-memory stand-in for packages/server
      msw/browser.ts      startMockApi() for the standalone dev:mock mode
```

The DTO types the server must return live next to each feature
(`features/*/types.ts`) until `packages/server` exists and exports them; see
[08-api-contract.md](08-api-contract.md).

### Conventions

- **File names:** components `PascalCase.tsx`, everything else `camelCase.ts`.
- **One component per file**, colocated `*.test.tsx`.
- **Feature boundaries:** a feature may import from `shared/`, `app/` and `api/`,
  and from another feature only through that feature's `index.ts`.
- **Types from kushibot:** import contract types (`LifecycleStatus`,
  `ExecutionIdentity`, `ExecutionScopeRef`, `DebugEvent`, `UsageAmounts` ...) with
  `import type` from the kushibot package root. The UI must never import runtime
  code from kushibot — it would pull server-only code into the bundle. Types the
  server adds on top (DTOs, pagination) live in `packages/server` and are exported
  as types for the UI.
- **No default exports** except route-level lazy pages (`React.lazy` needs them).

## `apps/standalone`

```
apps/standalone/
  index.html
  vite.config.ts          dev server proxies /api → packages/server (KUSHEX_SERVER_URL, default :8787)
  src/main.tsx            createRoot(...).render(<KushexPanel router="browser" apiBaseUrl="/api" />)
```

The app aliases `@kushex/ui` to `packages/ui/src` and compiles its Tailwind CSS
itself, so `pnpm dev` has HMR across both packages without building `ui` first.
`pnpm dev:mock` (Vite mode `mock`) serves the MSW mock backend from a service
worker, so the panel runs before `packages/server` exists.

## `packages/embed`

See [06-embedding.md](06-embedding.md).

## Tooling

| Tool | Config |
| --- | --- |
| pnpm workspaces | `pnpm-workspace.yaml` (already present) |
| Vite 8 | `@vitejs/plugin-react`, `@tailwindcss/vite` |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |
| ESLint 9 (flat config) | `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` |
| Prettier | `prettier-plugin-tailwindcss` to sort class names |
| Changesets | `.changeset/` (already present) for `@kushex/ui` and `@kushex/embed` releases |

### Dependencies for `packages/ui`

`packages/ui/package.json` already declares the package as `@kushex/ui` with
every dependency below, so a fresh checkout only needs `pnpm install` at the repo
root. Use the commands below to add the same set to a new package or to bump
everything to latest.

```sh
# 1. Peer dependencies: provided by the app that uses the panel
pnpm --filter @kushex/ui add --save-peer react react-dom antd

# 2. Peers again as dev dependencies, so the package builds and tests on its own
pnpm --filter @kushex/ui add -D react react-dom antd @types/react @types/react-dom

# 3. Runtime dependencies shipped with the panel
pnpm --filter @kushex/ui add @ant-design/icons antd-style @tabler/icons-react \
  @reduxjs/toolkit react-redux react-router

# 4. Build and test tooling
pnpm --filter @kushex/ui add -D typescript@^5.9 vite @vitejs/plugin-react \
  tailwindcss @tailwindcss/vite \
  vitest jsdom msw @testing-library/react @testing-library/dom @testing-library/user-event
```

| Group | Packages | Why there |
| --- | --- | --- |
| `peerDependencies` | `react`, `react-dom`, `antd` | The host app provides one copy; two copies of React break hooks, and two copies of antd break theming |
| `devDependencies` (peers) | same, plus `@types/react`, `@types/react-dom` | pnpm doesn't install peers for the package's own builds and tests |
| `dependencies` | `@ant-design/icons`, `antd-style`, `@tabler/icons-react`, `@reduxjs/toolkit`, `react-redux`, `react-router` | Internal to the panel; the host doesn't need to know about them |
| `devDependencies` (tooling) | TypeScript, Vite, Tailwind, Vitest, jsdom, MSW, Testing Library | Build/test only; Tailwind compiles into `dist/style.css` at build time |

Versions at the time of writing (October 2026): React 19.3, antd 6.6,
antd-style 4.1, Tabler Icons 3.49, Redux Toolkit 2.13, react-redux 9.3,
React Router 8.5, Tailwind 4.3, Vite 8.3, Vitest 5.0, MSW 3.0.

**TypeScript stays on 5.9** to match kushibot. TypeScript 7 (the native
compiler) is out; move both repos together once declaration-file generation for
the library build is confirmed to work with it.
