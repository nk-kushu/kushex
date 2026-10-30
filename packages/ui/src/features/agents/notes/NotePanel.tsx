import { Alert, Button, Input, Popconfirm, Tag, Tooltip, Typography, type InputRef } from "antd";
import {
  IconAlertTriangle,
  IconLink,
  IconNote,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useAppSelector } from "../../../app/hooks";
import { AppIcon } from "../../../shared/components/AppIcon";
import { borderAll, borderB, borderT } from "../../../shared/lib/styles";
import { selectNoteFontSize } from "../../settings/settingsSlice";
import { FileTypeIcon } from "../fileIcons";
import { lineLabel, type NoteAnchor } from "./codeNotes";
import { Markdown } from "../../../shared/components/Markdown";

/** A note being shown or written; `id` is null until a new note is saved. */
export type NoteView = Readonly<{
  id: string | null;
  /** Null for a general note, which is not tied to any code. */
  file: string | null;
  start: number;
  end: number;
  snippet: string;
  body: string;
  created?: string;
}>;

type Props = Readonly<{
  note: NoteView;
  /** Where the note's code is now; drafts are where they were just pinned. */
  anchor: NoteAnchor | null;
  saving: boolean;
  error: string | null;
  onSave: (body: string) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Shows the note's code in the editor. */
  onReveal: () => void;
  /** Pins the note to the lines selected in the editor; unset when nothing is selected. */
  onReattach?: () => void;
}>;

const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";
const PLACEHOLDER = `Write in markdown, e.g.

## Why this matters
- what it is about and why
- gotchas, TODOs, links`;

/** One note next to the code: its markdown and, if it is pinned, its lines and their code. */
export function NotePanel({
  note,
  anchor,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
  onReveal,
  onReattach,
}: Props) {
  const fontSize = useAppSelector(selectNoteFontSize);
  const isNew = note.id === null;
  const [editing, setEditing] = useState(isNew);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [text, setText] = useState(note.body);
  const input = useRef<InputRef>(null);
  useEffect(() => {
    if (editing && mode === "write") input.current?.focus({ cursor: isNew ? "end" : "all" });
  }, [editing, mode, isNew]);
  // A save that went through shows the note.
  const [saved, setSaved] = useState(note.body);
  if (saved !== note.body) {
    setSaved(note.body);
    setText(note.body);
    setEditing(false);
  }

  const lines = anchor ?? { start: note.start, end: note.end };
  const outdated = anchor?.status === "outdated";
  const missing = anchor?.status === "missing";
  const canSave = text.trim().length > 0 && (isNew || text !== note.body);
  const save = () => canSave && !saving && onSave(text);
  const cancel = () => {
    if (isNew) return onClose();
    setText(note.body);
    setEditing(false);
  };

  return (
    <aside
      aria-label={note.file === null ? "General note" : "Code note"}
      className="kx:flex kx:h-full kx:flex-col kx:bg-surface"
    >
      <div
        className={`kx:flex kx:h-9 kx:shrink-0 kx:items-center kx:gap-2 kx:pr-1 kx:pl-3 ${borderB}`}
      >
        <span aria-hidden className="kx:inline-flex kx:text-primary">
          <IconNote size={16} stroke={1.75} />
        </span>
        <Typography.Text strong className="kx:flex-1 kx:text-[13px]">
          {isNew ? "New note" : "Note"}
        </Typography.Text>
        {!isNew && !editing && (
          <>
            <Tooltip title="Edit">
              <Button
                type="text"
                size="small"
                onClick={() => setEditing(true)}
                icon={<AppIcon icon={IconPencil} label="Edit note" />}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this note?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
            >
              <Tooltip title="Delete">
                <Button
                  type="text"
                  size="small"
                  icon={<AppIcon icon={IconTrash} label="Delete note" />}
                />
              </Tooltip>
            </Popconfirm>
          </>
        )}
        <Tooltip title="Close">
          <Button
            type="text"
            size="small"
            onClick={onClose}
            icon={<AppIcon icon={IconX} label="Close note" />}
          />
        </Tooltip>
      </div>

      <div className="kx:flex kx:min-h-0 kx:flex-1 kx:flex-col kx:gap-3 kx:overflow-auto kx:p-3">
        {note.file !== null && (
          <div className="kx:flex kx:flex-col kx:gap-1.5">
            <button
              type="button"
              onClick={onReveal}
              title="Show in the editor"
              className="kx:flex kx:min-w-0 kx:cursor-pointer kx:items-center kx:gap-1.5 kx:border-0 kx:bg-transparent kx:p-0 kx:text-left kx:text-xs kx:text-text-muted kx:hover:text-primary"
            >
              <FileTypeIcon path={note.file} size={14} />
              <span className="kx:truncate kx:font-medium kx:text-text">{note.file}</span>
              <span className="kx:shrink-0">· {lineLabel(lines)}</span>
              {anchor?.status === "moved" && (
                <Tooltip title={`The code moved; the note followed it from ${lineLabel(note)}.`}>
                  <Tag className="kx:m-0 kx:shrink-0" bordered={false}>
                    moved
                  </Tag>
                </Tooltip>
              )}
            </button>
            <pre
              aria-label="Code the note points at"
              className={`kx:m-0 kx:max-h-44 kx:overflow-auto kx:bg-surface-muted kx:py-1.5 kx:font-mono kx:text-[11.5px] kx:leading-[1.5] ${borderAll} ${
                outdated || missing ? "kx:opacity-70" : ""
              }`}
            >
              {note.snippet.split("\n").map((line, index) => (
                <div key={index} className="kx:flex kx:gap-3 kx:pr-2">
                  <span
                    aria-hidden
                    className="kx:w-8 kx:shrink-0 kx:text-right kx:text-text-muted kx:select-none"
                  >
                    {lines.start + index}
                  </span>
                  <span className="kx:whitespace-pre">{line || " "}</span>
                </div>
              ))}
            </pre>
          </div>
        )}

        {(outdated || missing) && (
          <div className="kx:flex kx:flex-col kx:gap-2 kx:border kx:border-solid kx:border-warning/40 kx:bg-warning/10 kx:p-2.5">
            <div className="kx:flex kx:gap-2">
              <span className="kx:mt-0.5 kx:inline-flex kx:shrink-0 kx:text-warning">
                <IconAlertTriangle size={15} />
              </span>
              <div className="kx:flex kx:flex-col kx:gap-0.5 kx:text-xs">
                <span className="kx:font-medium kx:text-text">
                  {missing
                    ? "The file of this note is gone."
                    : "The code changed since this note was written."}
                </span>
                <span className="kx:text-text-muted">
                  {missing
                    ? "Delete the note, or open a file, select code and re-attach it there."
                    : "The snippet above is the code as it was. Select the right lines in the editor and re-attach."}
                </span>
              </div>
            </div>
            <Button
              size="small"
              className="kx:self-start"
              icon={<IconLink size={14} />}
              disabled={!onReattach}
              onClick={onReattach}
            >
              Re-attach to selection
            </Button>
          </div>
        )}

        {editing ? (
          <div className="kx:flex kx:flex-col kx:gap-2">
            <div role="tablist" aria-label="Note editor" className="kx:flex kx:gap-1">
              {(["write", "preview"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={`kx:cursor-pointer kx:border-0 kx:px-2 kx:py-0.5 kx:text-xs kx:font-medium kx:capitalize ${
                    mode === key
                      ? "kx:bg-primary/12 kx:text-primary"
                      : "kx:bg-transparent kx:text-text-muted kx:hover:text-text"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
            {mode === "write" ? (
              <Input.TextArea
                ref={input}
                aria-label="Note text"
                value={text}
                placeholder={PLACEHOLDER}
                autoSize={{ minRows: 8, maxRows: 28 }}
                className="kx:font-mono"
                style={{ fontSize }}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    save();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancel();
                  }
                }}
              />
            ) : (
              <div className={`kx:min-h-40 kx:px-3 kx:py-2 ${borderAll}`}>
                {text.trim() ? (
                  <Markdown text={text} style={{ fontSize }} />
                ) : (
                  <Typography.Text type="secondary">Nothing to preview.</Typography.Text>
                )}
              </div>
            )}
            {error && <Alert type="error" showIcon title={error} />}
            <div className="kx:flex kx:items-center kx:gap-2">
              <Typography.Text type="secondary" className="kx:flex-1 kx:text-[11px]">
                Markdown · {MOD}↵ to save · Esc to cancel
              </Typography.Text>
              <Button size="small" onClick={cancel}>
                Cancel
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={!canSave}
                loading={saving}
                onClick={save}
              >
                {isNew ? "Add note" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error && <Alert type="error" showIcon title={error} />}
            <Markdown text={note.body} style={{ fontSize }} />
          </>
        )}
      </div>

      <div
        className={`kx:flex kx:h-7 kx:shrink-0 kx:items-center kx:gap-1 kx:px-3 kx:text-[11px] kx:text-text-muted ${borderT}`}
      >
        <span className="kx:truncate">
          {note.created
            ? `Added ${new Date(note.created).toLocaleDateString(undefined, { dateStyle: "medium" })} · `
            : ""}
          Saved in the database
        </span>
      </div>
    </aside>
  );
}
