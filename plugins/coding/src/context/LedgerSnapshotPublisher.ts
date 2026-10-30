import type {
  CompressedContextSnapshotRequest,
  IContextSnapshotPublisher,
  IExecutionContext,
} from "kushibot";
import type { SessionContextLedger } from "./SessionContextLedger";

/**
 * **Creates the new version of the context once a summary has been accepted and saved.**
 *
 * This is the one seam kushibot ships *no* implementation for, because publishing a context
 * view is a host responsibility. `ContextSummaryInstaller` calls it and then refuses the
 * result if the returned ref equals the parent — a new view must be a new version.
 *
 * The spec lists what a real publisher owes its caller: authorize the exact source and summary
 * artifacts, pin the retained references, enforce compare-and-swap on the current parent,
 * recheck controls, and atomically persist an immutable versioned view plus a receipt before
 * returning its id.
 *
 * **This implementation does the first four and not the last.** It is in-process and in-memory:
 * when the run ends, the versions are gone. That is adequate for a single-process coding run
 * where the ledger *is* the session state, and it is honest about what it does not provide —
 * a resumed or externally supplied view would have nothing to recover from. Do not read this
 * class as evidence that durable publication works.
 *
 * Note the two-phase handoff: `reserve` stores the candidate under a new ref but leaves the
 * live view alone. The turn calls `ledger.adopt()` only after `install()` has fully validated
 * the result. Otherwise a validation failure *after* publish would leave the ledger holding a
 * view that was never approved. A durable publisher gets this for free by making the write
 * and the version bump one transaction.
 */
export class LedgerSnapshotPublisher implements IContextSnapshotPublisher {
  constructor(private readonly ledger: SessionContextLedger) {}

  async publish(
    request: CompressedContextSnapshotRequest,
    context: IExecutionContext,
  ): Promise<string> {
    // Recheck controls: this is a persistence step, and the run may have been cancelled while
    // the summary artifact was being written.
    context.signal.throwIfAborted();

    // Authorize the summary artifact rather than taking the reference on trust. A fabricated
    // reference string must not be able to pin itself into a published view.
    if (
      !/^[a-zA-Z0-9_.:/-]{1,240}$/.test(request.summaryArtifact.artifactId) ||
      !/^[a-f0-9]{64}$/.test(request.summaryArtifact.digest)
    )
      throw new Error("Summary artifact reference is not acceptable for publication.");

    // The candidate must actually contain the summary fragment that this artifact backs.
    // Without this, the publisher would happily pin an artifact the view never references.
    const installed = request.candidate.optionalFragments.find(
      (fragment) =>
        fragment.kind === "summary" &&
        fragment.revisionRef === request.summaryArtifact.digest &&
        fragment.sourceRef === `artifact:${request.summaryArtifact.artifactId}`,
    );
    if (!installed)
      throw new Error("Published view does not reference the saved summary artifact.");

    if (
      request.candidate.scope.scopeId !== context.scope.scopeId ||
      request.candidate.scope.projectId !== context.scope.projectId
    )
      throw new Error("Published view is outside the authenticated scope.");

    // Compare-and-swap against the current parent, then mint the new ref.
    return this.ledger.reserve(request.parentSnapshotRef, request.candidate.optionalFragments);
  }
}
