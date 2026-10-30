import { createHash } from "node:crypto";
import type { ContextFragment, ExecutionScopeRef } from "kushibot";

/** What the ledger remembers about a fragment so provenance can be rechecked later. */
type Provenance = Readonly<{ revisionRef: string; textDigest: string }>;

/**
 * **The agent's own record of what is in its context, and what version that context is.**
 *
 * Compression is built around two ideas that need somewhere to live:
 *
 * 1. **Fragments, not messages.** Kushibot's compression replaces *fragments*
 *    (identified pieces of context) rather than chat messages. So the session has to
 *    keep its history as fragments with stable ids.
 * 2. **A snapshot reference.** Every change to the context produces a new snapshot id.
 *    `ContextCompressionService` re-verifies that id three times during one compression,
 *    because a summary built from version 7 must never be installed onto version 9.
 *
 * This ledger owns both. It is deliberately in-memory and per-session: a coding run is a
 * single process holding one conversation. A durable agent would back this with the
 * session journal so a resumed run could verify the same provenance.
 *
 * **The invariant that makes verification meaningful:** for every fragment the ledger has
 * ever handed out, it stores the `revisionRef` *and* a digest of the text. A fragment that
 * claims revision `x` but whose text no longer hashes to the recorded digest is rejected.
 * Without the digest, `revisionRef` would be a label anyone could copy — the spec is
 * explicit that "a source label or matching revision string alone proves no authority".
 */
export class SessionContextLedger {
  /** Compressible history, oldest first. Observations and, after compression, summaries. */
  private optional: ContextFragment[] = [];
  /** Never offered to compression: the task and the agent's own notebook. */
  private required: ContextFragment[] = [];
  private readonly provenance = new Map<string, Provenance>();
  /** Bumped on every mutation; the snapshot ref is derived from it. */
  private revision = 0;
  /** Views handed to the publisher but not yet adopted, keyed by the ref it minted. */
  private readonly reserved = new Map<string, readonly ContextFragment[]>();

  constructor(
    private readonly sessionId: string,
    readonly scope: ExecutionScopeRef,
    /** Fragment text is capped by the input contract at 8 KiB; longer tool output is clipped. */
    private readonly maxFragmentBytes = 8192,
    /** The input contract allows at most 32 optional fragments. */
    private readonly maxOptionalFragments = 32,
  ) {}

  /** The current version of the context. Changes whenever any fragment changes. */
  get snapshotRef(): string {
    return `snapshot:${this.sessionId}:${this.revision}`;
  }

  get optionalFragments(): readonly ContextFragment[] {
    return Object.freeze([...this.optional]);
  }

  get requiredFragments(): readonly ContextFragment[] {
    return Object.freeze([...this.required]);
  }

  /** True when the history has grown past what the input contract will accept. */
  get atFragmentLimit(): boolean {
    return this.optional.length >= this.maxOptionalFragments;
  }

  /**
   * Replace the required set: the task and the latest notebook.
   *
   * These are rebuilt every turn because the notebook grows, and they are *required* so
   * compression can never select them. That is the point of the required/optional split:
   * the agent's goal and its own retained notes are not negotiable context.
   */
  setRequired(fragments: readonly ContextFragment[]): void {
    this.required = fragments.map((fragment) => this.record(fragment));
    this.revision += 1;
  }

  /** Append one tool observation to the compressible history. */
  appendObservation(id: string, sourceRef: string, text: string, priority: number): void {
    this.optional.push(
      this.record({
        id,
        kind: "observation",
        // Content-addressed: the revision *is* the digest, so a changed text cannot keep
        // claiming the same revision. Summary fragments instead carry their artifact digest.
        revisionRef: `sha256:${SessionContextLedger.digest(text)}`,
        sourceRef,
        text: this.clip(text),
        priority,
      }),
    );
    this.revision += 1;
  }

  /**
   * Store a candidate view under a fresh ref without making it current.
   *
   * Called by the snapshot publisher. Splitting "reserve" from "adopt" closes a real hole:
   * `ContextSummaryInstaller` validates the installed view *after* the publisher returns,
   * so if the publisher had already swapped the live view, a late validation failure would
   * leave the ledger holding a view nobody approved. A durable publisher would make the
   * write and the version bump one atomic transaction instead.
   */
  reserve(parentSnapshotRef: string, fragments: readonly ContextFragment[]): string {
    // Compare-and-swap. A summary prepared against an older version is refused here, which
    // is the last line of defence behind the service's own three snapshot verifications.
    if (parentSnapshotRef !== this.snapshotRef)
      throw new Error("Context snapshot changed while the summary was being prepared.");
    const ref = `snapshot:${this.sessionId}:${this.revision + 1}`;
    this.reserved.set(ref, Object.freeze([...fragments]));
    return ref;
  }

  /** Make a reserved view current, once the installer has fully validated it. */
  adopt(snapshotRef: string): void {
    const fragments = this.reserved.get(snapshotRef);
    if (!fragments) throw new Error("No reserved context snapshot matches that reference.");
    this.optional = fragments.map((fragment) => this.record(fragment));
    this.reserved.clear();
    this.revision += 1;
    // The adopted ref must be the one the publisher minted, or the verifier would reject
    // the very view we just installed.
    if (this.snapshotRef !== snapshotRef)
      throw new Error("Adopted snapshot reference does not match the published reference.");
  }

  /**
   * Re-check a fragment against what the ledger handed out. Used by the snapshot verifier.
   *
   * Returns false for an unknown id, a mismatched revision, or text that no longer matches
   * the recorded digest.
   */
  verifies(fragment: ContextFragment): boolean {
    const known = this.provenance.get(fragment.id);
    return (
      known !== undefined &&
      known.revisionRef === fragment.revisionRef &&
      known.textDigest === SessionContextLedger.digest(fragment.text)
    );
  }

  private record(fragment: ContextFragment): ContextFragment {
    const frozen = Object.freeze({ ...fragment, text: this.clip(fragment.text) });
    this.provenance.set(frozen.id, {
      revisionRef: frozen.revisionRef,
      textDigest: SessionContextLedger.digest(frozen.text),
    });
    return frozen;
  }

  /**
   * Keep fragment text inside the contract's 8 KiB limit.
   *
   * This is a real loss of evidence and the honest fix is different: write the full tool
   * output to the artifact store and keep only its reference in the fragment. That is what
   * the spec means by "original source text remains in its owning artifacts". The clip is
   * marked so neither the model nor a reader mistakes it for the whole output.
   */
  private clip(text: string): string {
    const encoded = new TextEncoder().encode(text);
    if (encoded.byteLength <= this.maxFragmentBytes) return text;
    const marker = `\n[clipped: ${encoded.byteLength} bytes total]`;
    const room = this.maxFragmentBytes - new TextEncoder().encode(marker).byteLength;
    // Decode with fatal:false so a cut in the middle of a multi-byte character cannot throw.
    return new TextDecoder().decode(encoded.subarray(0, room)) + marker;
  }

  private static digest(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }
}
