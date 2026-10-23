import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { useEffect, useRef } from "react";

/** The editor is a view only: it cannot accept edits or dispatch writes. */
export default function TextFileViewer({
  content,
  path,
}: Readonly<{ content: string; path: string }>) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const extension = path.split(".").at(-1)?.toLowerCase();
    const language: Extension =
      extension && ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension)
        ? javascript({
            typescript: extension === "ts" || extension === "tsx",
            jsx: extension === "jsx" || extension === "tsx",
          })
        : extension === "json"
          ? json()
          : extension === "md"
            ? markdown()
            : [];
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": `${path} contents`, tabindex: "0" }),
          lineNumbers(),
          highlightActiveLineGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          language,
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "var(--kx-ant-color-bg-container)",
              color: "var(--kx-ant-color-text)",
            },
            ".cm-scroller": { overflow: "auto", fontFamily: "monospace" },
            ".cm-gutters": {
              backgroundColor: "var(--kx-ant-color-bg-container)",
              color: "var(--kx-ant-color-text-secondary)",
              border: "none",
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [content, path]);
  return <div ref={container} className="kx:min-h-0 kx:flex-1 kx:overflow-hidden" />;
}
