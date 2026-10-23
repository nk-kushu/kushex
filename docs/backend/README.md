# Backend plan

Status: **proposal**. These documents define how to build `packages/server` for
Kushex's coding workbench. The application foundation (phase 1) and project/workspace browsing (phase 2) are implemented;
see [04-foundation.md](04-foundation.md) and [05-projects-and-workspaces.md](05-projects-and-workspaces.md).

| Document | Purpose |
| --- | --- |
| [01-overview.md](01-overview.md) | Current frontend, backend responsibilities, module boundaries, and runtime behavior |
| [02-project-structure.md](02-project-structure.md) | Proposed folders, class ownership, dependency rules, and polymorphism |
| [03-implementation-plan.md](03-implementation-plan.md) | Incremental delivery order and acceptance criteria |
| [04-foundation.md](04-foundation.md) | Implemented foundation: tooling, lifecycle, database/migrations, health and error contracts, actor and workspace decisions |
| [05-projects-and-workspaces.md](05-projects-and-workspaces.md) | Implemented project registration, containment, read-only browsing, and frontend contracts |

Start with the overview, then use the folder structure as the implementation
reference. Follow the project's [backend OOP skill](../../.agents/skills/backend-oop/SKILL.md)
when implementing the plan.
