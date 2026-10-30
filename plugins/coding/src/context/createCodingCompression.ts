import {
  ArtifactContextSummaryStore,
  ContextCompositionInputContract,
  ContextCompressionService,
  ContextSummaryInstaller,
  DynamicContextFormatter,
  JsonValueContract,
  StableContextFormatter,
  type IArtifactWriter,
  type IClock,
  type IScopedDebugRecorder,
} from "kushibot";
import { ConversationByteSizer } from "./ConversationByteSizer";
import { DedupingSummaryAcceptance } from "./DedupingSummaryAcceptance";
import { LedgerSnapshotPublisher } from "./LedgerSnapshotPublisher";
import { LedgerSnapshotVerifier } from "./LedgerSnapshotVerifier";
import { RecentWindowCompressionPolicy } from "./RecentWindowCompressionPolicy";
import { RepeatedObservationSummaryProvider } from "./RepeatedObservationSummaryProvider";
import type { SessionContextLedger } from "./SessionContextLedger";

/** Tuning for one session's compression. Every field has a deliberate default. */
export type CodingCompressionSettings = Readonly<{
  /** Newest fragments never offered for compression. Protects what the model is using now. */
  keepRecent?: number;
  /** Cap on the proposal payload. Must be 1..8192; the service rejects anything outside. */
  maxSummaryBytes?: number;
  /** Estimated bytes a summary must save before it is accepted at all. */
  minimumByteSaving?: number;
  /** Token allowance added per request by the sizer, for overhead the messages do not show. */
  overheadTokens?: number;
}>;

/**
 * **Builds the compression service for one coding session.**
 *
 * `ContextCompressionService` takes twelve dependencies and no defaults. That is the design:
 * each one is a decision the framework refuses to make on your behalf, because getting any of
 * them wrong is how compression loses information. Walking them in order:
 *
 * | # | Argument | Why you supply it |
 * |---|---|---|
 * | 1 | `inputContract` | Validates *and* normalizes the input. It deep-copies, sorts every object's keys, nulls prototypes, and freezes — everything downstream works on that copy, not your object. |
 * | 2 | `snapshots` | Provenance. Called three times per compression. A stub returning `true` disables the freshness guarantee entirely. |
 * | 3 | `policy` | Which fragments to collapse. Sees ids and kinds only, never text. |
 * | 4 | `provider` | How to collapse them. Deterministic here; a model provider is the alternative. |
 * | 5 | `acceptance` | Whether the result may replace real context. The only thing separating a plausible summary from an installed one. |
 * | 6 | `store` | Where the derived record goes. Shipped implementation, your artifact writer. |
 * | 7 | `stable` | Renders instructions. Identical before and after, which is what keeps the measurement a fair comparison. |
 * | 8 | `dynamic` | Renders the assignment and fragments. The measurement uses this, so the turn must send the same shape or the numbers are fiction. |
 * | 9 | `sizer` | Token counting for your model. |
 * | 10 | `json` | Shared finite-JSON contract. |
 * | 11 | `clock` | Deadline checks. Pass the run's clock so compression shares the run's deadline. |
 * | 12 | `maxSummaryBytes` | Proposal budget, 1..8192. |
 * | 13 | `debug` | Optional tracing. Ids, codes and counts only — never source text. |
 *
 * **On swapping in a model provider.** `ModelContextSummaryProvider` is exported and works,
 * but `DedupingSummaryAcceptance` below requires each point to equal its source text, so every
 * paraphrase a model returns is rejected and you have paid for the call. Real abstractive
 * compression needs a verifier that can judge meaning — source fidelity, preserved uncertainty,
 * omitted conditions — and the current `ISummaryAcceptanceVerifier` returns a plain boolean,
 * with nowhere to report its own token usage, stops, or uncertain child operations. The spec
 * calls that out as not implemented. Deterministic grouping first is not a limitation to work
 * around; it is the part you can actually verify.
 */
export function createCodingCompression(
  ledger: SessionContextLedger,
  artifacts: IArtifactWriter,
  clock: IClock,
  debug: IScopedDebugRecorder,
  settings: CodingCompressionSettings = {},
): Readonly<{ compression: ContextCompressionService; installer: ContextSummaryInstaller }> {
  const {
    keepRecent = 4,
    maxSummaryBytes = 4096,
    minimumByteSaving = 512,
    overheadTokens = 1024,
  } = settings;

  // One shared JSON contract: the service hands it to SummaryProposalContract, and the
  // summary store uses its own for the saved record.
  const json = new JsonValueContract();
  const inputContract = new ContextCompositionInputContract(json);

  const compression = new ContextCompressionService(
    inputContract,
    new LedgerSnapshotVerifier(ledger),
    new RecentWindowCompressionPolicy(keepRecent),
    new RepeatedObservationSummaryProvider(),
    new DedupingSummaryAcceptance(minimumByteSaving),
    // The shipped store, bound to the host's artifact writer. It re-validates the record
    // through ContextSummaryRecordContract and caps it at 32 KiB before writing, and uses
    // the summary id as the idempotency key so a retried save cannot duplicate the artifact.
    new ArtifactContextSummaryStore(artifacts),
    new StableContextFormatter(),
    new DynamicContextFormatter(),
    new ConversationByteSizer(overheadTokens),
    json,
    clock,
    maxSummaryBytes,
    debug,
  );

  // Installation is a *separate* persistence step, and deliberately so: a saved artifact is
  // not proof that a new context view was installed. The installer splices the summary into
  // the window it replaced, leaves required fragments, assignment, instructions and rules
  // untouched, validates the candidate before publishing, and refuses a publisher that
  // returns the parent's own reference.
  const installer = new ContextSummaryInstaller(new LedgerSnapshotPublisher(ledger), inputContract);

  return Object.freeze({ compression, installer });
}
