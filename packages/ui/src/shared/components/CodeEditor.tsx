import Editor, { type OnChange, type OnMount } from "@monaco-editor/react";
import { Spin } from "antd";
import { useThemeMode } from "antd-style";
import type { editor } from "monaco-editor";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  sh: "shell",
  sql: "sql",
  xml: "xml",
};

/** Monaco language id for a file path, or "plaintext" when the extension is unknown. */
export function languageForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (extension && LANGUAGE_BY_EXTENSION[extension]) || "plaintext";
}

export type CodeEditorProps = Readonly<{
  value: string;
  /** File path; used to pick the language and as the Monaco model identity. */
  path?: string;
  /** Overrides the language inferred from `path`. */
  language?: string;
  /** Defaults to true: the editor is a viewer unless a caller opts in to editing. */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onMount?: OnMount;
  ariaLabel?: string;
  options?: editor.IStandaloneEditorConstructionOptions;
  className?: string;
}>;

/** The one Monaco editor for the whole frontend. Fills its parent's height. */
export function CodeEditor({
  value,
  path,
  language,
  readOnly = true,
  onChange,
  onMount,
  ariaLabel,
  options,
  className = "kx:min-h-0 kx:flex-1 kx:overflow-hidden",
}: CodeEditorProps) {
  const { isDarkMode } = useThemeMode();
  const handleChange: OnChange = (next) => onChange?.(next ?? "");
  return (
    <div className={className}>
      <Editor
        height="100%"
        path={path}
        language={language ?? (path ? languageForPath(path) : "plaintext")}
        value={value}
        theme={isDarkMode ? "vs-dark" : "light"}
        loading={<Spin aria-label="Loading editor" />}
        onChange={handleChange}
        onMount={onMount}
        options={{
          readOnly,
          domReadOnly: readOnly,
          ariaLabel: ariaLabel ?? (path ? `${path} contents` : "Editor contents"),
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          ...options,
        }}
      />
    </div>
  );
}

export default CodeEditor;
