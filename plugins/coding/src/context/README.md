# Context compression for the coding agent

Opt in from the host:

```ts
createCodingAgent({
  workspace,
  artifacts,
  profile,
  gateway,
  compression: { enabled: true, keepRecent: 4, minimumByteSaving: 512 },
});
```

Omit `compression` and nothing changes: sessions keep kushibot's `AgentModelTurn`, one growing
conversation that stops at `CONTEXT_WINDOW_FULL`. Nothing in the kushibot library is modified.

## Read the files in this order

| File                                    | Role                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `SessionContextLedger.ts`               | Holds the history as fragments and owns the snapshot version.               |
| `RecentWindowCompressionPolicy.ts`      | **Seam 1** — which fragments to collapse. Protects the newest `keepRecent`. |
| `RepeatedObservationSummaryProvider.ts` | **Seam 2** — groups byte-identical texts. No model call.                    |
| `DedupingSummaryAcceptance.ts`          | **Seam 3** — exact fidelity, full coverage, and a worthwhile saving.        |
| `LedgerSnapshotVerifier.ts`             | Provenance. Called three times per compression.                             |
| `LedgerSnapshotPublisher.ts`            | Mints the new snapshot version. In-process only.                            |
| `ConversationByteSizer.ts`              | Token upper bound, shared with the window check.                            |
| `createCodingCompression.ts`            | Wires all twelve `ContextCompressionService` arguments.                     |
| `CompressingCodingTurn.ts`              | Drives compress → install → model call, once per turn.                      |
| `CompressingCodingSessions.ts`          | Builds the session, since `createTurn()` is not a seam.                     |

## What a turn does

1. Record the previous tool result as an `observation` fragment.
2. Rebuild the required fragments: the task, and the notebook as `memory`. Neither is ever
   offered to compression.
3. One bounded compression attempt. `prepared` → install and adopt; `unchanged` → carry on;
   `stopped`/`uncertain` → end the turn and keep the pending references.
4. Render with `StableContextFormatter` + `DynamicContextFormatter` — the same formatters the
   measurement used, so the reported saving describes the request actually sent.
5. Check the window. If it still does not fit, stop. Never drop context to make room.
6. Call the model, then record the chosen action as a fragment.

## Three things measured here, not assumed

- **Observation ids defeat dedup.** `AgenticSession` reports a tool result as
  `{ operationId, toolId, value }` with a fresh id per dispatch, so identical polls produce
  different text. With the id left in place, a seven-poll session produced
  `SUMMARY_NOT_ACCEPTED` every time and zero summaries. `CompressingCodingTurn.observation()`
  moves the id into `sourceRef`, where provenance belongs; dedup then works.
- **Small windows cost more than they save.** A summary carries
  `{id, sourceRef, revisionRef}` per replaced fragment plus the unresolved and pending lists,
  and its text is JSON nested inside JSON, so quotes are escaped twice. Collapsing 2–4 short
  duplicates makes the request _bigger_. `DedupingSummaryAcceptance` rejects those before any
  artifact is written.
- **The artifact is written before the saving is measured.** An `unchanged` outcome can carry
  `savedArtifact`: a stored summary no view references. Retention owns it from there.

## Not provided

`LedgerSnapshotPublisher` is in-memory, so published versions do not survive the run. A durable
publisher must persist the view and its receipt atomically and support recovery.

Acceptance is a `boolean`, which is enough for deterministic validators only. A model-assisted
verifier needs somewhere to report its own usage, stops and uncertain child operations, so
`ModelContextSummaryProvider` would have every paraphrase rejected by the verifier here. See
the note in `createCodingCompression.ts`.
