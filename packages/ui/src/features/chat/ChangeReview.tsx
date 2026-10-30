import { DiffEditor } from "@monaco-editor/react";
import { Alert, Button, Modal, Select, Spin, Switch, Tag } from "antd";
import { useThemeMode } from "antd-style";
import { useState } from "react";
import { languageForPath } from "../../shared/components/CodeEditor";
import { useEditorFontSize } from "../../shared/lib/editorFontSize";

/** Exact versions belonging to a server-recorded proposal. */
export type ReviewedChange = Readonly<{
  path: string;
  before: string | null;
  after: string | null;
}>;

export type ChangeReviewProps = Readonly<{
  changes: readonly ReviewedChange[];
  open: boolean;
  applying: boolean;
  applied: boolean;
  proposalId?: string;
  summary?: string;
  status?: "ready" | "pending" | "applied" | "not-applied";
  code?: string;
  checking?: boolean;
  error?: string | null;
  onClose(): void;
  onApply(): void;
  onCheck?(): void;
}>;

/** A read-only comparison; the apply callback must refer to the same recorded proposal. */
export function ChangeReview({
  changes,
  open,
  applying,
  applied,
  proposalId = "review",
  summary,
  status = applied ? "applied" : "ready",
  code,
  checking,
  error,
  onClose,
  onApply,
  onCheck,
}: ChangeReviewProps) {
  const { isDarkMode } = useThemeMode();
  const fontSize = useEditorFontSize();
  const [selected, setSelected] = useState(changes[0]?.path);
  const [sideBySide, setSideBySide] = useState(true);
  const change = changes.find((entry) => entry.path === selected) ?? changes[0];
  return (
    <Modal
      title="Review proposed changes"
      open={open}
      onCancel={onClose}
      width="min(1200px, 95vw)"
      mask={{ closable: !applying }}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
        ...(status === "pending"
          ? [
              <Button
                key="check"
                aria-label="Check application status"
                disabled={applying || checking}
                loading={applying || checking}
                onClick={onCheck}
              >
                Check application status
              </Button>,
            ]
          : []),
        <Button
          key="apply"
          type="primary"
          disabled={status !== "ready" || changes.length === 0 || checking}
          loading={applying}
          onClick={onApply}
        >
          {applied ? "Applied" : "Accept and apply"}
        </Button>,
      ]}
    >
      <div className="kx:flex kx:flex-col kx:gap-3">
        {summary && <div className="kx:whitespace-pre-wrap">{summary}</div>}
        {error && <Alert type="error" showIcon title={error} />}
        {applied && <Alert type="success" showIcon title="Changes applied to the project." />}
        {status === "pending" && (
          <Alert
            type="warning"
            showIcon
            title="Application outcome is pending"
            description="Some files may have changed. Check the application status before taking further action."
          />
        )}
        {status === "not-applied" && (
          <Alert
            type="error"
            showIcon
            title={
              code === "TARGET_CHANGED"
                ? "Project files changed since this proposal was prepared."
                : "The changes were not applied."
            }
            description="Run the agent again against the current project to prepare a new proposal."
          />
        )}
        <Select
          aria-label="Changed file"
          value={change?.path}
          onChange={setSelected}
          options={changes.map((entry) => ({
            value: entry.path,
            label: `${entry.path}${entry.before === null ? " (new file)" : entry.after === null ? " (deleted)" : ""}`,
          }))}
        />
        {change && (
          <>
            <div className="kx:flex kx:items-center kx:justify-between kx:gap-2 kx:text-xs">
              <div>
                <Tag>
                  {change.before === null
                    ? "New file"
                    : change.after === null
                      ? "Deleted file"
                      : "Modified file"}
                </Tag>
                Original → Proposed
              </div>
              <Switch
                checked={sideBySide}
                onChange={setSideBySide}
                checkedChildren="Side by side"
                unCheckedChildren="Inline"
                aria-label="Side by side diff"
              />
            </div>
            <div className="kx:h-[60vh] kx:min-h-64 kx:overflow-hidden">
              <DiffEditor
                height="100%"
                originalModelPath={`proposal://${proposalId}/before/${change.path}`}
                modifiedModelPath={`proposal://${proposalId}/after/${change.path}`}
                original={change.before ?? ""}
                modified={change.after ?? ""}
                language={languageForPath(change.path)}
                theme={isDarkMode ? "vs-dark" : "light"}
                loading={<Spin aria-label="Loading diff" />}
                options={{
                  readOnly: true,
                  originalEditable: false,
                  domReadOnly: true,
                  automaticLayout: true,
                  renderSideBySide: sideBySide,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  ariaLabel: `${change.path} proposed changes`,
                  fontSize,
                }}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
