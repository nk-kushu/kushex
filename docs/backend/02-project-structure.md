# 02 — Backend project structure

Status: **proposed target structure**. Implement it incrementally inside
`packages/server`; do not create empty modules merely to match this tree.
Use the project's [backend OOP skill](../../.agents/skills/backend-oop/SKILL.md),
including its polymorphism guidance.

## Top-level layout

```text
packages/server/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── migrations/                    # Ordered PostgreSQL schema changes
├── src/
│   ├── index.ts                   # Construct application, start, delegate signals
│   ├── app/
│   │   ├── Application.ts         # Own startup/shutdown and resource lifecycle
│   │   └── ApplicationFactory.ts  # Wire concrete collaborators; composition root
│   ├── config/
│   │   └── ServerConfig.ts        # Parse and validate environment once
│   ├── transport/
│   │   ├── http/
│   │   │   ├── HttpServer.ts      # HTTP server lifecycle, route registration
│   │   │   ├── Router.ts          # Route matching / chosen router wrapper
│   │   │   ├── RequestContext.ts  # Actor, scope, request/correlation ID
│   │   │   ├── ErrorResponder.ts  # Domain/application errors -> HTTP responses
│   │   │   └── HealthController.ts
│   │   └── sse/
│   │       └── ExecutionEventStream.ts # Replay, heartbeat, cleanup, backpressure
│   ├── modules/
│   │   ├── projects/
│   │   ├── workspaces/
│   │   ├── chat/
│   │   ├── executions/
│   │   ├── tasks/
│   │   ├── files/
│   │   ├── changes/
│   │   ├── notes/
│   │   └── settings/
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── PostgresDatabase.ts  # Connection pool and transaction sessions
│   │   │   └── PostgresTransactionManager.ts
│   │   ├── agent/
│   │   │   └── <Runtime>AgentRuntime.ts # Chosen runtime, not a decided provider
│   │   ├── workspace/
│   │   │   ├── LocalWorkspaceFileSystem.ts
│   │   │   └── GitWorkspaceAdapter.ts
│   │   └── logging/
│   │       └── ConsoleLogger.ts
│   └── shared/
│       ├── application/
│       │   ├── Clock.ts           # Contract, where deterministic time is needed
│       │   ├── Logger.ts          # Contract for structured logging
│       │   └── TransactionManager.ts
│       └── domain/
│           ├── DomainError.ts
│           └── EntityId.ts        # Only if ID rules warrant a shared abstraction
└── tests/
    ├── integration/               # PostgreSQL repositories and HTTP boundaries
    ├── acceptance/                # Message -> execution -> proposal -> decision
    └── support/                   # Fixtures, database cleanup, runtime doubles
```

This is one deployable backend. `modules/` groups business capabilities;
`transport/` holds shared HTTP/SSE mechanics; `infrastructure/` owns shared
external adapters. Module-specific persistence implementations live in their
module. Avoid a global folder of unrelated controllers or services.

Migration scripts are executable deployment tooling, not application request
handlers. Choose their runner with the database tooling; migrations must be an
explicit startup/deployment step rather than arbitrary DDL in controllers.

## Inside a feature module

Use chat as the reference. Other modules adopt these subfolders only when needed:

```text
modules/chat/
├── domain/
│   ├── Thread.ts                  # Thread invariants and identity
│   ├── Message.ts                 # Valid message behavior, not a DTO wrapper
│   └── ContextReference.ts        # File/note/task reference data types
├── application/
│   ├── ChatService.ts             # Conversation use cases and orchestration
│   ├── ChatContextResolver.ts     # Resolve authorized referenced content
│   └── ports/
│       ├── ThreadRepository.ts
│       └── MessageRepository.ts
├── infrastructure/
│   ├── PostgresThreadRepository.ts
│   └── PostgresMessageRepository.ts
├── http/
│   ├── ChatController.ts          # Validate/map request; invoke service
│   ├── chatSchemas.ts             # Runtime request validation definitions
│   └── chatDtos.ts                # Plain request/response data contracts
├── public.ts                     # Deliberate cross-module application surface
└── application/ChatService.test.ts # Unit tests can sit beside the tested class
```

Place `AgentRuntime` in `modules/executions/application/ports/`, because execution
orchestration consumes it. Place `WorkspaceFileSystem` in the workspaces module's
application ports. Keep domain-specific ports with their owning feature, not in
`shared/` just because several adapters implement them.

## Initial class responsibilities

| Module | Main classes/contracts to introduce when implementing it |
| --- | --- |
| Projects | `Project`, `ProjectService`, `ProjectRepository`, `PostgresProjectRepository`, `ProjectsController` |
| Workspaces | `Workspace`, `WorkspaceService`, `WorkspaceRepository`, `WorkspaceFileSystem`, `WorkspaceGit` |
| Chat | `Thread`, `Message`, `ChatService`, context resolver, message/thread repositories, `ChatController` |
| Executions | `Execution`, `ExecutionService`, `ExecutionDispatcher`, `AgentRuntime`, execution/event repositories, `ExecutionsController` |
| Tasks | `Task`, `TaskService`, `StartTaskWithAgentService`, task/activity repositories, `TasksController` |
| Files | `FileService`, `FilesController`; use workspace ports for physical file access |
| Changes | `ChangeProposal`, `ChangeService`, `ChangeProposalRepository`, `ChangesController` |
| Notes | `Note`, `NoteService`, `NoteRepository`, `NotesController` |
| Settings | `SettingsService`, scoped settings repository, `SettingsController` |

These names describe roles, not a requirement to create every class immediately.
Start with one cohesive application service per small module; split a use case
when it has independent dependencies or coordination responsibilities. Do not
introduce abstract base controllers, universal entity managers, or a generic
repository that hides feature-specific operations.

## Dependency rules

1. Domain objects contain business rules and depend on no HTTP, database, or agent
   SDK. Plain DTOs remain TypeScript data shapes; entity classes protect actual
   invariants rather than merely exposing getters and setters.
2. Application services coordinate domain behavior through constructor-injected
   repositories, runtime ports, and collaborators. They do not construct pools,
   SDK clients, controllers, or concrete storage adapters.
3. Controllers translate validated transport data to use cases and map results
   back to DTOs. They contain no SQL, agent orchestration, or patch application.
4. Infrastructure implements application ports and maps persisted/provider data
   into application/domain types. Transactions pass an explicit transaction session
   so repositories participating in one operation share the same database transaction.
5. `ApplicationFactory` selects implementations and wires dependencies. The
   application owns startup order and reverse-order shutdown, including execution
   cancellation/reconciliation policy, streams, HTTP, and database connections.
6. Cross-module imports use `public.ts`, never another module's controller or
   infrastructure internals. Coordinate chat/task/execution workflows through
   application contracts; do not make services recursively depend on each other.
7. Promote code to `shared/` only for a proven common responsibility. Helpers used
   by one class stay private methods of that class. Prefer readonly dependencies
   and private state over globals, static service classes, or service locators.

## Polymorphism in practice

`ExecutionService` depends on `AgentRuntime`, not a provider name. The contract
will describe start/cancel behavior, normalized events, capabilities, and failure
semantics; its exact methods follow the selected runtime's verified API.

A real runtime adapter and a deterministic test runtime implement the same
contract. Adding another supported runtime should require a new adapter and
composition-root wiring, rather than repeated provider switches in chat, tasks,
and controllers. Implementations must preserve the same lifecycle guarantees;
unsupported capabilities must be explicit before execution starts.

The same principle applies to `WorkspaceFileSystem` (local vs future remote) and
repositories (PostgreSQL vs test doubles). Prefer interfaces and composition;
use an abstract class only when variants share real behavior and invariants.
Do not invent production variants or inheritance hierarchies for hypothetical use.

## Frontend contracts

Keep domain entities and infrastructure types private to the server. Map them to
plain JSON DTOs at the HTTP boundary. When frontend integration starts, introduce
`packages/contracts/` for browser-safe DTOs, event envelopes, and reusable request
schemas, with no server startup code or runtime SDK dependency.

That is a proposed additional workspace package, not an existing one. Update
workspace consumers, the lockfile, Docker's manifest-copy steps, and development
mounts when adding it. Do not import backend classes or agent SDKs into React.

Write the new endpoint/event contract alongside the first vertical feature.
Use stable IDs, bounded pagination, revision tokens, and consistent
`{ code, message }` errors. Existing starter `{ error }` responses need alignment
at that stage. UI layout details such as tab selection and split sizes stay local.
