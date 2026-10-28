import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { Monaco } from "../agentLanguage";
import { noteTitle, type CodeNote, type NoteAnchor } from "./codeNotes";

export type PinnedNote = Readonly<{ note: CodeNote; anchor: NoteAnchor }>;
export type LineRange = Readonly<{ start: number; end: number }>;

type Options = Readonly<{
  /** Notes on the model shown. */
  notes: readonly PinnedNote[];
  selectedId: string | null;
  /** Whether notes can be added to the model shown (not to read-only library code). */
  enabled: boolean;
  onOpen: (id: string) => void;
  onAdd: (range: LineRange) => void;
}>;

const ADD_ACTION = "kushex.addCodeNote";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const ADD_NOTE_KEYS = isMac ? "⌘⌥N" : "Ctrl+Alt+N";
const TITLE_LENGTH = 60;

/**
 * The selected lines, without blank lines at either end; a selection ending at the start of
 * a line leaves that line out.
 */
export function selectedLines(instance: editor.ICodeEditor): LineRange | null {
  const selection = instance.getSelection();
  const model = instance.getModel();
  if (!selection || !model) return null;
  let start = selection.startLineNumber;
  let end = selection.endLineNumber;
  if (end > start && selection.endColumn === 1) end -= 1;
  const blank = (line: number) => model.getLineContent(line).trim() === "";
  while (start < end && blank(start)) start += 1;
  while (end > start && blank(end)) end -= 1;
  return { start, end };
}

/**
 * Code notes in a Monaco editor: noted lines get a bar in the gutter and the note's title at
 * the end of their first line; clicking either opens the note. Selecting code shows an
 * "Add note" button, also in the context menu and on Cmd/Ctrl+Alt+N.
 */
export function useCodeNotes(
  instance: editor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  options: Options,
) {
  // Editor events read the options of the latest render.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [model, setModel] = useState(0);
  const decorations = useRef<editor.IEditorDecorationsCollection | null>(null);
  const placeWidget = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!instance || !monaco) return;
    decorations.current = instance.createDecorationsCollection();
    const add = () => {
      const lines = selectedLines(instance);
      if (lines && latest.current.enabled) latest.current.onAdd(lines);
    };

    // The floating button over a selection.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kx-note-add-widget";
    button.title = `Add a note to the selected lines (${ADD_NOTE_KEYS})`;
    button.innerHTML = `<span>✎ Add note</span><kbd>${ADD_NOTE_KEYS}</kbd>`;
    // Keep the selection: the editor would collapse it on mouse down.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", add);
    let at: { lineNumber: number; column: number } | null = null;
    const widget: editor.IContentWidget = {
      allowEditorOverflow: true,
      getId: () => "kushex.codeNoteAdd",
      getDomNode: () => button,
      getPosition: () =>
        at && {
          position: at,
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        },
    };
    instance.addContentWidget(widget);
    const place = () => {
      const selection = instance.getSelection();
      at =
        latest.current.enabled && selection && !selection.isEmpty()
          ? { lineNumber: selection.startLineNumber, column: selection.startColumn }
          : null;
      instance.layoutContentWidget(widget);
    };
    placeWidget.current = place;

    const action = instance.addAction({
      id: ADD_ACTION,
      label: "Add Note to Selection",
      contextMenuGroupId: "1_kushex",
      contextMenuOrder: 1,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyN],
      run: add,
    });

    /** The note on `line`; the shortest one when notes overlap. */
    const noteAt = (line: number, firstLineOnly = false) =>
      latest.current.notes
        .filter(({ anchor }) =>
          firstLineOnly ? anchor.start === line : anchor.start <= line && line <= anchor.end,
        )
        .sort((a, b) => a.anchor.end - a.anchor.start - (b.anchor.end - b.anchor.start))[0];

    const { MouseTargetType } = monaco.editor;
    const subscriptions = [
      instance.onDidChangeModel(() => {
        setModel((value) => value + 1);
        place();
      }),
      instance.onDidChangeCursorSelection(place),
      instance.onMouseDown((event) => {
        const line = event.target.position?.lineNumber;
        if (!line) return;
        if (event.target.type === MouseTargetType.GUTTER_LINE_DECORATIONS) {
          const found = noteAt(line);
          if (found) latest.current.onOpen(found.note.id);
          return;
        }
        // The title is injected text, rendered with its own class name.
        if (event.target.element?.closest(".kx-code-note-inline")) {
          const found = noteAt(line, true);
          if (found) {
            event.event.preventDefault();
            latest.current.onOpen(found.note.id);
          }
        }
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      action.dispose();
      instance.removeContentWidget(widget);
      decorations.current?.clear();
      placeWidget.current = null;
    };
  }, [instance, monaco]);

  const { notes, selectedId, enabled } = options;
  // Library code takes no notes, so the button follows whether notes can be added.
  useEffect(() => placeWidget.current?.(), [enabled]);

  useEffect(() => {
    const textModel = instance?.getModel();
    if (!monaco || !decorations.current || !textModel) return;
    const stickiness = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
    const lineCount = textModel.getLineCount();
    const byStart = new Map<number, PinnedNote[]>();
    for (const pinned of notes) {
      const start = Math.min(pinned.anchor.start, lineCount);
      byStart.set(start, [...(byStart.get(start) ?? []), pinned]);
    }
    decorations.current.set([
      ...notes.map(({ note, anchor }) => {
        const outdated = anchor.status === "outdated" ? " kx-outdated" : "";
        return {
          range: new monaco.Range(
            Math.min(anchor.start, lineCount),
            1,
            Math.min(anchor.end, lineCount),
            1,
          ),
          options: {
            isWholeLine: true,
            className: `kx-code-note-line${note.id === selectedId ? " kx-selected" : ""}`,
            linesDecorationsClassName: `kx-code-note-bar${outdated}`,
            stickiness,
          },
        };
      }),
      ...[...byStart].map(([line, pinned]) => {
        const column = textModel.getLineMaxColumn(line);
        const title =
          pinned.length === 1 ? noteTitle(pinned[0]!.note.body) : `${pinned.length} notes`;
        const outdated = pinned.some(({ anchor }) => anchor.status === "outdated");
        return {
          range: new monaco.Range(line, column, line, column),
          options: {
            after: {
              content: `   ✎ ${title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH)}…` : title}`,
              inlineClassName: `kx-code-note-inline${outdated ? " kx-outdated" : ""}`,
              cursorStops: monaco.editor.InjectedTextCursorStops.None,
            },
            showIfCollapsed: true,
            hoverMessage: pinned.map(({ note, anchor }) => ({
              value: `${
                anchor.status === "outdated"
                  ? "⚠️ *The code changed since this note was written.*\n\n"
                  : ""
              }${note.body || "_Empty note_"}`,
            })),
            stickiness,
          },
        };
      }),
    ]);
  }, [monaco, instance, notes, selectedId, model]);
}
