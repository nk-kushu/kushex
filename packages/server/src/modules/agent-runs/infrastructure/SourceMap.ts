/** A position in a script or its source; both 0-based, as in the inspector protocol. */
export type Position = Readonly<{ line: number; column: number }>;

type Segment = Readonly<{ generated: Position; original: Position }>;

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Maps between a generated script and its one TypeScript source, the shape tsx and tsc
 * produce: each module has a source map of its own file. Mappings into other sources are
 * ignored.
 */
export class SourceMap {
  /** Ordered by generated position. */
  private readonly segments: readonly Segment[];
  /** Ordered by original position. */
  private readonly byOriginal: readonly Segment[];

  private constructor(
    segments: Segment[],
    /** URL of the source, resolved against the map's URL; null when the map names none. */
    readonly sourceUrl: string | null,
    /** The source's text when the map embeds it (`sourcesContent`). */
    readonly sourceContent: string | null,
  ) {
    this.segments = segments;
    this.byOriginal = [...segments].sort(
      (a, b) => a.original.line - b.original.line || a.original.column - b.original.column,
    );
  }

  /** Reads a `data:` source map URL; returns null for external or malformed maps. */
  static fromDataUrl(url: string, scriptUrl = ""): SourceMap | null {
    const match = /^data:application\/json[^,]*?(;base64)?,(.*)$/s.exec(url);
    if (!match) return null;
    try {
      const text = match[1]
        ? Buffer.from(match[2]!, "base64").toString("utf8")
        : decodeURIComponent(match[2]!);
      return SourceMap.fromJson(text, scriptUrl);
    } catch {
      return null;
    }
  }

  /** Parses a source map file; `mapUrl` resolves its relative source path. */
  static fromJson(text: string, mapUrl: string): SourceMap | null {
    try {
      const map = JSON.parse(text) as {
        mappings?: unknown;
        sourceRoot?: unknown;
        sources?: unknown;
        sourcesContent?: unknown;
      };
      if (typeof map.mappings !== "string") return null;
      const source = Array.isArray(map.sources) ? map.sources[0] : undefined;
      const content = Array.isArray(map.sourcesContent) ? map.sourcesContent[0] : undefined;
      return new SourceMap(
        SourceMap.decode(map.mappings),
        typeof source === "string" ? SourceMap.resolve(source, map.sourceRoot, mapUrl) : null,
        typeof content === "string" ? content : null,
      );
    } catch {
      return null;
    }
  }

  private static resolve(source: string, root: unknown, mapUrl: string): string | null {
    const prefix = typeof root === "string" && root ? root.replace(/\/?$/, "/") : "";
    try {
      return new URL(prefix + source, mapUrl || undefined).href;
    } catch {
      return null;
    }
  }

  /**
   * The first generated position of `line` in the source, or of the next line with code
   * within `lookahead` lines, the way editors move a breakpoint set on a blank line.
   */
  generatedFor(line: number, lookahead = 20): Readonly<{ line: number; at: Position }> | null {
    for (let candidate = line; candidate <= line + lookahead; candidate++) {
      const first = this.byOriginal
        .filter((segment) => segment.original.line === candidate)
        .reduce<Segment | null>(
          (best, segment) =>
            !best ||
            segment.generated.line < best.generated.line ||
            (segment.generated.line === best.generated.line &&
              segment.generated.column < best.generated.column)
              ? segment
              : best,
          null,
        );
      if (first) return { line: candidate, at: first.generated };
    }
    return null;
  }

  /** The source position of a generated one: the closest mapping at or before it. */
  originalFor(position: Position): Position | null {
    let found: Segment | null = null;
    for (const segment of this.segments) {
      const { line, column } = segment.generated;
      if (line > position.line || (line === position.line && column > position.column)) break;
      found = segment;
    }
    // A mapping from an earlier line belongs to code before this position; prefer the
    // first mapping on the position's own line when there is one.
    if (found && found.generated.line !== position.line) {
      const sameLine = this.segments.find((segment) => segment.generated.line === position.line);
      if (sameLine) found = sameLine;
    }
    return found?.original ?? null;
  }

  private static decode(mappings: string): Segment[] {
    const segments: Segment[] = [];
    let source = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let generatedLine = 0;
    for (const line of mappings.split(";")) {
      let generatedColumn = 0;
      for (const encoded of line.split(",")) {
        if (!encoded) continue;
        const fields = SourceMap.vlq(encoded);
        generatedColumn += fields[0] ?? 0;
        if (fields.length < 4) continue;
        source += fields[1]!;
        originalLine += fields[2]!;
        originalColumn += fields[3]!;
        if (source === 0)
          segments.push({
            generated: { line: generatedLine, column: generatedColumn },
            original: { line: originalLine, column: originalColumn },
          });
      }
      generatedLine++;
    }
    return segments;
  }

  private static vlq(encoded: string): number[] {
    const values: number[] = [];
    let value = 0;
    let shift = 0;
    for (const char of encoded) {
      const digit = BASE64.indexOf(char);
      if (digit < 0) throw new Error("Invalid source map.");
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
        continue;
      }
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
    return values;
  }
}
