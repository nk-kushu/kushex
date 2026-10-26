/**
 * A file path inside an agent folder, e.g. `prompts/review.md`. Segments use letters,
 * digits, `.`, `_` and `-` and never start with a dot, so `..`, hidden files and the
 * store's temporary files cannot be addressed.
 */
export class AgentFilePath {
  private static readonly segment = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
  static readonly maxDepth = 8;
  private static readonly maxLength = 512;

  readonly segments: readonly string[];

  constructor(readonly value: string) {
    if (!AgentFilePath.isValid(value)) throw new Error(`Invalid agent file path: ${value}`);
    this.segments = value.split("/");
  }

  static isValid(value: string): boolean {
    if (value.length > AgentFilePath.maxLength) return false;
    const segments = value.split("/");
    return (
      segments.length <= AgentFilePath.maxDepth &&
      segments.every((segment) => AgentFilePath.isValidSegment(segment))
    );
  }

  static isValidSegment(segment: string): boolean {
    return AgentFilePath.segment.test(segment);
  }

  /** The containing folders, outermost first. */
  get parents(): readonly string[] {
    return this.segments.slice(0, -1);
  }

  toString(): string {
    return this.value;
  }
}
