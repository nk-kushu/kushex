# 01 — Frontend overview

## Purpose

The Kushex UI is an operator panel over a kushibot runtime. It lets a person:

- browse workflow runs and drill into step runs, attempts and agentic sessions;
- follow a run live (lifecycle transitions, debug events, usage);
- read artifacts produced by executors (paged, searchable, immutable);
- see budgets and usage (`modelCalls`, `inputTokens`, `outputTokens`, `toolCalls`,
  `iterations`, `fixes`) against limits;
- act on runs that need a human: approve a publication, pause, resume, stop, cancel.

The UI never talks to kushibot directly. It talks to `packages/server`, which owns
the kushibot runtime, its SQL binding and credentials. The browser only holds what
the server returns for the viewer's scope.

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| UI library | **React 19** | Function components and hooks only |
| Component system | **Ant Design 6** (`antd@^6`) | Layout, tables, forms, feedback, data display |
| Token-aware styles | **antd-style 4** (`antd-style@^4`, peer `antd >=6`) | `createStyles` for custom components that need antd tokens, responsive helpers, app-wide theme mode |
| Utility CSS | **Tailwind CSS 4** (`tailwindcss@^4`, `@tailwindcss/vite`) | Spacing, layout glue, small one-off pieces |
| State | **Redux Toolkit 2** (`@reduxjs/toolkit@^2`, `react-redux@^9`) | Client state in slices, server state in RTK Query |
| Routing | React Router 8 (`react-router@^8`) | Standalone app only; the embed gets a memory router |
| Icons (primary) | **Tabler Icons** (`@tabler/icons-react@^3`) | ~6,000 MIT icons, one consistent outline style, tree-shakeable; used for all app icons through `AppIcon` (see [05](05-screens-and-components.md#icons)) |
| Icons (antd internals) | `@ant-design/icons@^6` | Already pulled in by antd; used only where an antd API expects its icons |
| Language | TypeScript 5.9, `strict` | Same as kushibot |
| Build | Vite 8 | Library mode for `packages/ui` and `packages/embed` |
| Tests | Vitest 5 + Testing Library + MSW 3, Playwright for e2e | See [07](07-testing-and-quality.md) |

Pin exact versions in `package.json` when the packages are first installed
(`pnpm add antd@latest ...`) and upgrade deliberately through Changesets. The
majors above are the contract this doc set is written against.

## Rules of thumb

1. **Ant Design first.** If antd has a component for it (Table, Descriptions,
   Timeline, Steps, Drawer, Tag, Statistic, Form...), use it. Tailwind is for layout
   and spacing around antd components, not for rebuilding them.
2. **One source of design tokens.** Colors, radius and font come from the antd
   theme. `antd-style` reads them directly (`token.colorPrimary`), Tailwind reads
   the same values through CSS variables (see [03](03-styling-antd-tailwind.md)).
   Never hard-code hex values in components.
3. **Pick the styling tool by job:** layout and spacing → Tailwind classes;
   a custom component with real styling (states, nested parts, token math) →
   `antd-style` `createStyles`; an antd component's look → theme/component tokens.
4. **Server state lives in RTK Query, client state lives in slices.** Do not copy
   API responses into slices.
5. **The panel is embeddable.** No global singletons: the store, router and theme
   are created per mounted panel instance (see [06](06-embedding.md)).
6. **Read-mostly, explicit actions.** Destructive or authority-carrying actions
   (stop, cancel, approve publication) always go through a confirm step and show
   the server's receipt or error, never an optimistic success.

## How it fits the monorepo

```
kushex/
  packages/
    ui/        React panel: screens, components, store, API client   ← most frontend code
    embed/     Thin mount layer: mountKushex(el, options) for host apps
    server/    HTTP + SSE API over the kushibot runtime
  apps/
    standalone/ Vite app that renders <KushexPanel/> full-page with a router
```

`packages/ui` exports a single `<KushexPanel />` root plus its option types.
`apps/standalone` and `packages/embed` are both consumers of it.
