import type {
  IContextSummaryProvider,
  IExecutionContext,
  SummaryProviderOutcome,
  SummaryRequest,
} from "kushibot";

/**
 * **Turns the selected fragments into a proposed summary.**
 *
 * The second seam. This one is deterministic and makes no model call, which is the right
 * starting point: it cannot hallucinate, cannot cost tokens, and cannot fail halfway with
 * charged usage you have to reconcile.
 *
 * It groups fragments whose text is **exactly equal** and keeps every contributing id. For a
 * coding agent that is not a toy case — it is the common one. The agent polls a check, calls
 * `cli` with `true` to refresh status, or re-reads the same file, and gets back a byte-identical
 * observation each time. Six identical "check queued" results become one line with six source
 * links.
 *
 * **Why no paraphrasing.** The acceptance verifier downstream demands that each point's text
 * equal its source text. That is intentional: it makes this provider's output *verifiable*.
 * A model that rewrote six observations into "tests were still pending" would read better and
 * be unprovable. If you want that, you must also write a verifier that can judge meaning —
 * see the note in `createCodingCompression.ts`.
 *
 * Returning `unavailable` rather than an oversized proposal matters: the service treats it as
 * `unchanged` and skips acceptance and the artifact write entirely.
 */
export class RepeatedObservationSummaryProvider implements IContextSummaryProvider {
  /** Recorded into the summary artifact, so a saved summary says what produced it. */
  readonly id = "coding-repeated-observation";
  readonly version = "1";

  async propose(
    request: SummaryRequest,
    _context: IExecutionContext,
  ): Promise<SummaryProviderOutcome> {
    // Group by exact text. A Map preserves insertion order, so the points come out in order
    // of first appearance rather than in some hash order. Grouped order is not a new
    // chronology — the saved record keeps the ordered original ids for that.
    const groups = new Map<string, string[]>();
    for (const source of request.sources) {
      const ids = groups.get(source.text) ?? [];
      ids.push(source.id);
      groups.set(source.text, ids);
    }

    const points = [...groups].map(([text, sourceIds]) => ({ text, sourceIds }));

    // The proposal contract caps points at 8. With at most 8 offered sources this cannot
    // trip, but the check documents the limit instead of relying on the window size.
    if (points.length > 8) return { status: "unavailable" };

    // Check the size budget here rather than letting the contract reject it later. Same
    // outcome for the caller, but it keeps the reason local to the code that chose the shape.
    const proposal = { points };
    if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > request.maxSummaryBytes)
      return { status: "unavailable" };

    // `value` is typed `unknown` on purpose: the service re-validates it through
    // SummaryProposalContract even though this provider is trusted, in-process code.
    return { status: "proposed", value: proposal };
  }
}
