import type {
  ContextCompositionInput,
  IContextSnapshotVerifier,
  IExecutionContext,
} from "kushibot";
import type { SessionContextLedger } from "./SessionContextLedger";

/**
 * **Answers one question: is this context still the real, current context?**
 *
 * `ContextCompressionService` asks this **three times** in a single compression — before
 * selecting, after acceptance, and again before returning the prepared candidate. That is not
 * paranoia about this code; it is because a model call sits in the middle. Between "these six
 * observations look alike" and "here is a summary of them", a tool may have run and changed
 * the history. A summary installed onto a view it was not built from is how an agent ends up
 * reasoning about evidence that no longer exists.
 *
 * Returning `true` unconditionally — which is what a test stub does — silently disables all
 * three checks. This implementation checks three things:
 *
 * - the scope matches the authenticated execution scope,
 * - the snapshot ref is the ledger's *current* ref, not a past or reserved one, and
 * - every fragment still matches the revision **and text digest** the ledger recorded.
 *
 * The digest is the part that carries the weight. `revisionRef` is just a string in a JSON
 * object; anything can claim `sha256:abc`. Re-hashing the text is what makes the claim mean
 * something, and it is why the ledger stores both.
 */
export class LedgerSnapshotVerifier implements IContextSnapshotVerifier {
  constructor(private readonly ledger: SessionContextLedger) {}

  async verify(input: ContextCompositionInput, context: IExecutionContext): Promise<boolean> {
    // The service also compares scopes, but a verifier that trusts the scope it was handed
    // would be useless in any setup where the input crosses a boundary first.
    if (
      input.scope.scopeId !== context.scope.scopeId ||
      input.scope.projectId !== context.scope.projectId ||
      input.scope.workspaceId !== context.scope.workspaceId
    )
      return false;

    // Freshness. A prepared summary carries the ref it was built from, so this is what makes
    // a stale or replayed `prepared` object fail instead of installing.
    if (input.snapshotRef !== this.ledger.snapshotRef) return false;

    // Content identity for every fragment, required and optional alike.
    return [...input.requiredFragments, ...input.optionalFragments].every((fragment) =>
      this.ledger.verifies(fragment),
    );
  }
}
