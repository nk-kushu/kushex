import { CodeEditor } from "../../shared/components/CodeEditor";

/** The editor is a view only: it cannot accept edits or dispatch writes. */
export default function TextFileViewer({
  content,
  path,
}: Readonly<{ content: string; path: string }>) {
  return <CodeEditor value={content} path={path} readOnly />;
}
