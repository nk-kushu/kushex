# Kushex docs

Kushex is the harness panel for [kushibot](../../kushibot): a web UI to inspect and
operate workflow runs, step attempts, agentic sessions, artifacts, usage budgets,
debug traces and publication approvals.

## Frontend

| Doc | What it covers |
| --- | --- |
| [frontend/01-overview.md](frontend/01-overview.md) | Goals, stack, and how the frontend fits the monorepo |
| [frontend/02-project-structure.md](frontend/02-project-structure.md) | Package layout, folder conventions, build tooling |
| [frontend/03-styling-antd-tailwind.md](frontend/03-styling-antd-tailwind.md) | Ant Design + antd-style + Tailwind CSS together: who does what, layers, tokens, theming, dark mode |
| [frontend/04-state-management.md](frontend/04-state-management.md) | Redux Toolkit store, slices, RTK Query, live updates |
| [frontend/05-screens-and-components.md](frontend/05-screens-and-components.md) | Screens, routes, and which antd components back them |
| [frontend/06-embedding.md](frontend/06-embedding.md) | Mounting the panel inside a host app (`packages/embed`) |
| [frontend/07-testing-and-quality.md](frontend/07-testing-and-quality.md) | Testing, linting, accessibility, performance budgets |
| [frontend/08-api-contract.md](frontend/08-api-contract.md) | Endpoints, headers and command rules the UI expects from `packages/server` |
