# Kushex docs

Kushex is the harness panel for [kushibot](../../kushibot): a web UI to inspect and
operate workflow runs, step attempts, agentic sessions, artifacts, usage budgets,
debug traces and publication approvals.

## Plans

| Doc | What it covers |
| --- | --- |
| [harness-plan.md](harness-plan.md) | Wireframe of the harness panel: regions and the Projects, Files, Chat, Tasks, Notes and Settings screens |

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

## Backend

The backend plan follows the current coding workbench frontend. Older run-oriented
frontend API/state documents contain proposals that do not match the current source;
see the backend overview for the current implementation baseline.

| Doc | What it covers |
| --- | --- |
| [backend/README.md](backend/README.md) | Backend plan index and status |
| [backend/01-overview.md](backend/01-overview.md) | Frontend requirements, module boundaries, and coding chat flow |
| [backend/02-project-structure.md](backend/02-project-structure.md) | Proposed backend folders, OOP responsibilities, and polymorphic contracts |
| [backend/03-implementation-plan.md](backend/03-implementation-plan.md) | Delivery phases and acceptance criteria |
