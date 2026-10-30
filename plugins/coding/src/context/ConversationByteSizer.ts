import type { IModelInputSizer, ModelRequest } from "kushibot";

/**
 * **Estimates how many input tokens a request will cost.**
 *
 * Kushibot ships no implementation: token counting is model-specific, so the host supplies it.
 * Compression uses it to compare the view before and after replacement, and rejects the
 * candidate unless the count *drops*.
 *
 * This one reuses the same heuristic `AgentModelTurn` applies to the uncompressed
 * conversation — serialized bytes plus a fixed allowance for request overhead — so that the
 * compression decision and the window check agree. Two different estimators would be worse
 * than a crude one: compression could report a saving against a yardstick the window check
 * never uses.
 *
 * The name says `upperBound` and it matters. This is a conservative *planning* number, not a
 * measured bill. One byte per token is pessimistic for English prose, where roughly four bytes
 * per token is typical — which is the right direction to be wrong in. For real accounting, use
 * the usage the provider reports back. Swap this for a real tokenizer when you have one; the
 * only contract is a positive safe integer.
 */
export class ConversationByteSizer implements IModelInputSizer {
  constructor(
    /** Allowance for tool definitions, role framing and other per-request overhead. */
    private readonly overheadTokens = 1024,
  ) {
    if (!Number.isSafeInteger(overheadTokens) || overheadTokens < 0)
      throw new Error("overheadTokens must be a non-negative integer.");
  }

  async upperBound(request: Pick<ModelRequest, "instructions" | "messages">): Promise<number> {
    // Serialize exactly what will be sent, so message framing is counted too.
    const payload = JSON.stringify({
      instructions: request.instructions,
      messages: request.messages,
    });
    // The service throws unless this is a positive safe integer, so never return 0.
    return new TextEncoder().encode(payload).byteLength + this.overheadTokens;
  }
}
