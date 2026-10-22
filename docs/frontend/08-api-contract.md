# 08 — API contract (UI ↔ `packages/server`)

`packages/server` does not exist yet. This is what the UI calls. The DTO types are
in `packages/ui/src/features/*/types.ts`, and the in-memory implementation in
`packages/ui/src/test/msw/handlers.ts` is an executable version of this contract.
Move the types to `packages/server` when it is created and have the UI
`import type` them.

## Every request

| Header | Meaning |
| --- | --- |
| `authorization: Bearer <token>` | From the host's `getAuthToken()`, when set |
| `x-kushex-project`, `x-kushex-workspace` | Scope picked in the header. Only a filter: the server still enforces the viewer's scope |

Errors: any non-2xx returns `{ "code": string, "message": string }`. The UI treats
`404`, `401/403` and `409` specially (see `ErrorResult`). On commands, `409` means
"changed since you opened this; reload".

## Endpoints

| Method & path | Query / body | Response |
| --- | --- | --- |
| `GET /health` | — | `{ status: "ok" \| "degraded", version }` |
| `GET /scopes` | — | `ScopeOption[]` |
| `GET /runs` | `status` (comma list), `search`, `page`, `pageSize`, `sort` (`createdAt:desc\|asc`) | `Page<RunSummary>` |
| `GET /runs/:runId` | — | `RunDetail` |
| `POST /runs/:runId/{pause\|resume\|stop\|cancel}` | `{ commandId, reason? }` | `RunCommandReceipt` |
| `GET /runs/:runId/debug-events` | `afterSequence`, `limit`, `minLevel`, `channel` | kushibot `DebugEventPage` |
| `GET /runs/:runId/events` | `Last-Event-ID` header | `text/event-stream`; each message `data` is a kushibot `DebugEvent`, `id` is its `eventId` |
| `GET /sessions` | `runId?`, `page`, `pageSize` | `Page<SessionSummary>` |
| `GET /sessions/:sessionId` | — | `SessionDetail` |
| `GET /artifacts` | `search?`, `runId?`, `cursor?` | `CursorPage<ArtifactSummary>` |
| `GET /artifacts/:artifactId/pages` | `cursor?` | kushibot `ArtifactPage` |
| `GET /usage` | — | `{ rows: BudgetUsageRow[] }` (tree through `parentScopeId`) |
| `GET /approvals` | `status?` | `PublicationSummary[]` |
| `GET /approvals/:proposalId` | — | `PublicationDetail` (`review: null` until reviewed) |
| `POST /approvals/:proposalId/{approve\|reject}` | `{ commandId, digest, reason? }` | `PublicationDecisionReceipt` |

## Command rules

- `commandId` is generated when the confirm dialog opens and is reused on retry.
  The same `commandId` for the same command must return the original receipt.
  For a different command it must return `409` (kushibot
  `CommandIdentityConflictError`).
- A run command the lifecycle does not allow from the current status returns `409`.
- An approval whose `digest` no longer matches the proposal returns `409`.
