import type { CompressionDecision, CompressionPolicyInput, IPolicy } from "kushibot";

/**
 * **Chooses which part of the history to collapse.**
 *
 * This is the first of the three seams you own. Note what the policy is *given*: ids, kinds
 * and priorities only — never the fragment text. Selection is a structural decision, so the
 * framework withholds the content to keep it that way.
 *
 * The shipped `ContiguousObservationCompressionPolicy` takes the first contiguous run it
 * finds from the very start of the list. That is a safe default but a poor fit for a coding
 * agent, because recency matters: the last few tool results are what the model is reasoning
 * about right now. Collapsing those is how a summary ends up saying "ran the tests" while
 * losing the actual failure the agent was about to fix.
 *
 * So this policy:
 * - **protects the newest `keepRecent` fragments** from selection entirely, and
 * - picks the **longest contiguous run** of `source`/`observation` in what remains.
 *
 * `ContextCompressionService` re-checks everything returned here (known ids, allowed kinds,
 * contiguity, uniqueness, at most 8). A policy cannot widen its own authority by returning
 * more — a bad decision becomes an `unchanged` outcome, not a silent removal.
 */
export class RecentWindowCompressionPolicy implements IPolicy<
  CompressionPolicyInput,
  CompressionDecision
> {
  constructor(
    /** How many of the newest fragments stay verbatim. Compression never touches these. */
    private readonly keepRecent = 4,
  ) {
    if (!Number.isSafeInteger(keepRecent) || keepRecent < 0)
      throw new Error("keepRecent must be a non-negative integer.");
  }

  async apply(input: CompressionPolicyInput): Promise<CompressionDecision> {
    // Only fragments older than the protected tail are eligible.
    const eligible = input.candidates.slice(
      0,
      Math.max(0, input.candidates.length - this.keepRecent),
    );

    // Walk the eligible prefix and collect every contiguous run of compressible kinds.
    // Contiguity is a hard requirement of the service: replacing a scattered set would
    // reorder the surviving history and invent a chronology that never happened.
    let best: string[] = [];
    let current: string[] = [];
    for (const candidate of eligible) {
      if (candidate.kind === "source" || candidate.kind === "observation") {
        current.push(candidate.id);
        // `>` keeps the *oldest* of two equally long runs, which is what we want: older
        // context is the context the model is least likely to still be using.
        if (current.length > best.length) best = [...current];
      } else {
        // A `summary`, `memory` or `handoff` fragment ends the run. Summaries in particular
        // must break it, or a second pass would summarize a summary and compound its losses.
        current = [];
      }
    }

    // The service refuses a window smaller than 2 anyway; returning nothing is clearer than
    // offering a one-fragment "group" that cannot possibly shrink anything.
    // `maxSources` is the service's cap (8) — read it rather than hardcoding.
    return {
      sourceIds: Object.freeze(best.length >= 2 ? best.slice(0, input.maxSources) : []),
    };
  }
}
