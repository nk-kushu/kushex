import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { Monaco } from "../agentLanguage";

type Options = Readonly<{
  /** Breakpoints of the model shown, or null when it cannot have any (read-only scripts). */
  lines: readonly number[] | null;
  /** Lines whose breakpoint the debugger could not bind. */
  unverified: ReadonlySet<number>;
  /** The selected frame's line in the model shown; `top` for the line about to run. */
  current: Readonly<{ line: number; top: boolean }> | null;
  onToggle: (line: number) => void;
  /** Edits moved the breakpoints along with their lines. */
  onMoved: (lines: number[]) => void;
}>;

/**
 * Breakpoints and the paused line in a Monaco editor, VS Code style: clicking the glyph
 * margin toggles a breakpoint, breakpoints move with edits, the paused line is highlighted.
 */
export function useDebugDecorations(
  instance: editor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  options: Options,
) {
  // Editor events read the options of the latest render.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  // Decorations belong to a model; a new model means drawing them again.
  const [model, setModel] = useState(0);
  const breakpoints = useRef<editor.IEditorDecorationsCollection | null>(null);
  const position = useRef<editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!instance || !monaco) return;
    breakpoints.current = instance.createDecorationsCollection();
    position.current = instance.createDecorationsCollection();
    const hint = instance.createDecorationsCollection();
    const glyph = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
    const subscriptions = [
      instance.onDidChangeModel(() => setModel((value) => value + 1)),
      instance.onMouseDown((event) => {
        if (event.target.type !== glyph || !event.target.position || !latest.current.lines) return;
        latest.current.onToggle(event.target.position.lineNumber);
      }),
      instance.onMouseMove((event) => {
        const line = event.target.position?.lineNumber;
        const show =
          event.target.type === glyph &&
          line &&
          latest.current.lines &&
          !latest.current.lines.includes(line);
        hint.set(
          show
            ? [
                {
                  range: new monaco.Range(line, 1, line, 1),
                  options: { glyphMarginClassName: "kx-breakpoint-hint-glyph" },
                },
              ]
            : [],
        );
      }),
      instance.onMouseLeave(() => hint.clear()),
      instance.onDidChangeModelContent(() => {
        const lines = latest.current.lines;
        const moved = breakpoints.current?.getRanges().map((range) => range.startLineNumber);
        if (!lines || !moved) return;
        const unique = [...new Set(moved)].sort((a, b) => a - b);
        if (unique.join() !== lines.join()) latest.current.onMoved(unique);
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      breakpoints.current?.clear();
      position.current?.clear();
      hint.clear();
    };
  }, [instance, monaco]);

  const { lines, unverified, current } = options;
  useEffect(() => {
    if (!monaco || !breakpoints.current) return;
    breakpoints.current.set(
      (lines ?? []).map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: `kx-breakpoint-glyph${unverified.has(line) ? " kx-unverified" : ""}`,
          glyphMarginHoverMessage: {
            value: unverified.has(line)
              ? "Breakpoint not bound: no code on or after this line"
              : "Breakpoint",
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  }, [monaco, lines, unverified, model]);

  useEffect(() => {
    if (!monaco || !position.current || !instance) return;
    position.current.set(
      current
        ? [
            {
              range: new monaco.Range(current.line, 1, current.line, 1),
              options: {
                isWholeLine: true,
                className: current.top ? "kx-debug-current-line" : "kx-debug-frame-line",
                glyphMarginClassName: current.top
                  ? "kx-debug-current-glyph"
                  : "kx-debug-frame-glyph",
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            },
          ]
        : [],
    );
    if (current) instance.revealLineInCenterIfOutsideViewport(current.line);
  }, [monaco, instance, current?.line, current?.top, model]); // eslint-disable-line react-hooks/exhaustive-deps
}
