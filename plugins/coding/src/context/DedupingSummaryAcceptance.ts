import type {
  IExecutionContext,
  ISummaryAcceptanceVerifier,
  SummaryProposal,
  SummaryRequest,
} from "kushibot";

/**
 * **Decides whether a proposed summary may replace real context.**
 *
 * The third and most important seam. The provider above is trusted in-process code, so it is
 * tempting to skip this. Don't: the whole design rests on *generation and acceptance being
 * separate*. The day you swap in `ModelContextSummaryProvider`, this is the only thing
 * standing between a fluent paraphrase and your agent's working context.
 *
 * Three checks, all deterministic:
 *
 * 1. **Fidelity** — every point's text must *equal* the text of each source it cites. This is
 *    the same rule as the shipped `ExtractiveSummaryAcceptanceVerifier`. It means a summary
 *    can only ever be an exact extraction, so there is no way for it to soften a condition,
 *    promote a guess to a fact, or drop the reason behind a decision.
 * 2. **Coverage** — every offered source must appear in some point. A proposal that quietly
 *    omits one source is not a summary of the window, it is a deletion.
 * 3. **Worthwhile** — at least one point must cover two or more sources, and the estimated
 *    byte saving must clear a margin.
 *
 * Check 3 is the one the shipped verifier does not do, and it is here for a measured reason.
 * The service writes the summary artifact *before* it measures the real saving, so a summary
 * that turns out not to help still costs an artifact write and comes back as
 * `unchanged / NO_MEASURED_SAVING` with a `savedArtifact` you now have to retain or clean up.
 * Collapsing short duplicates genuinely does make the request *bigger*: the summary carries
 * `{id, sourceRef, revisionRef}` for every replaced fragment plus the unresolved and pending
 * lists, and its text is JSON embedded inside JSON, so every quote is escaped twice. Rejecting
 * here costs nothing and avoids the write.
 *
 * It is a pre-check, not a replacement: the service still measures the real before/after and
 * can still return `NO_MEASURED_SAVING`. The estimate below deliberately ignores the
 * unresolved and pending lists (not visible from a `SummaryRequest`), which makes it
 * optimistic — hence the margin.
 */
export class DedupingSummaryAcceptance implements ISummaryAcceptanceVerifier {
  /** Recorded into the artifact: a reader can see which rules admitted this summary. */
  readonly id = "coding-exact-dedup-with-saving";
  readonly version = "1";

  constructor(
    /** Estimated bytes that must be saved before a summary is worth installing. */
    private readonly minimumByteSaving = 512,
  ) {
    if (!Number.isSafeInteger(minimumByteSaving) || minimumByteSaving < 0)
      throw new Error("minimumByteSaving must be a non-negative integer.");
  }

  async verify(
    proposal: SummaryProposal,
    request: SummaryRequest,
    _context: IExecutionContext,
  ): Promise<boolean> {
    const sources = new Map(request.sources.map((source) => [source.id, source.text]));
    const covered = new Set<string>();

    // 1 + 2: exact fidelity and complete coverage.
    for (const point of proposal.points)
      for (const id of point.sourceIds) {
        if (sources.get(id) !== point.text) return false;
        covered.add(id);
      }
    if (covered.size !== sources.size) return false;

    // 3a: something must actually have been deduplicated. If every point cites exactly one
    // source then this "summary" is a verbatim copy of the window with extra bookkeeping.
    if (!proposal.points.some((point) => point.sourceIds.length >= 2)) return false;

    // 3b: estimate the swap the way DynamicContextFormatter will render it.
    const replaced = request.sources.reduce(
      (total, source) =>
        total +
        DedupingSummaryAcceptance.bytes(
          JSON.stringify({
            id: source.id,
            kind: source.kind,
            revisionRef: source.revisionRef,
            sourceRef: source.sourceRef,
            text: source.text,
          }),
        ),
      0,
    );

    // The text the service will build for the installed fragment.
    const summaryText = JSON.stringify({
      derived: true,
      points: proposal.points,
      sources: request.sources.map((source) => ({
        id: source.id,
        sourceRef: source.sourceRef,
        revisionRef: source.revisionRef,
      })),
      unresolved: [],
      pendingOperationRefs: [],
    });

    // Wrapping it in the fragment envelope is what applies the second round of JSON escaping,
    // so measure the envelope rather than the bare text.
    const installed = DedupingSummaryAcceptance.bytes(
      JSON.stringify({
        id: `summary:${"x".repeat(36)}`,
        kind: "summary",
        revisionRef: "0".repeat(64),
        sourceRef: `artifact:${"x".repeat(40)}`,
        text: summaryText,
      }),
    );

    return replaced - installed >= this.minimumByteSaving;
  }

  private static bytes(text: string): number {
    return new TextEncoder().encode(text).byteLength;
  }
}
