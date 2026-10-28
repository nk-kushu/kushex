import { Button, Input, Popconfirm, Tooltip, Typography } from "antd";
import { IconAlertTriangle, IconNote, IconSearch, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { borderT } from "../../../shared/lib/styles";
import { FileTypeIcon } from "../fileIcons";
import { lineLabel, noteTitle } from "./codeNotes";
import { ADD_NOTE_KEYS, type PinnedNote } from "./useCodeNotes";

/** The rest of a note after its title, as one line of plain text. */
const excerpt = (body: string) =>
  body
    .split("\n")
    .slice(1)
    .join(" ")
    .replace(/[#*_`>~-]|\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Every code note of the agent, by file; the open file's notes first. */
export function NotesList({
  notes,
  activeFile,
  selectedId,
  onOpen,
  onDeleteOrphaned,
}: Readonly<{
  notes: readonly PinnedNote[];
  activeFile: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  /** Deletes the notes whose file is gone. */
  onDeleteOrphaned: () => Promise<void>;
}>) {
  const [query, setQuery] = useState("");
  const orphaned = notes.filter(({ anchor }) => anchor.status === "missing").length;
  const filter = query.trim().toLowerCase();
  const shown = notes.filter(
    ({ note }) =>
      !filter ||
      note.body.toLowerCase().includes(filter) ||
      note.file.toLowerCase().includes(filter),
  );
  const files = [...new Set(shown.map(({ note }) => note.file))].sort((a, b) =>
    a === activeFile ? -1 : b === activeFile ? 1 : a.localeCompare(b),
  );

  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      {notes.length > 0 && (
        <div className="kx:shrink-0 kx:px-2 kx:py-2">
          <Input
            size="small"
            allowClear
            aria-label="Filter notes"
            placeholder="Filter notes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setQuery("")}
            prefix={
              <span className="kx:inline-flex kx:text-text-muted">
                <IconSearch size={14} stroke={1.75} />
              </span>
            }
          />
        </div>
      )}
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto">
        {notes.length === 0 ? (
          <div className="kx:flex kx:flex-col kx:items-center kx:gap-2 kx:px-5 kx:py-10 kx:text-center">
            <span aria-hidden className="kx:inline-flex kx:text-primary kx:opacity-80">
              <IconNote size={28} stroke={1.5} />
            </span>
            <Typography.Text strong>No notes yet</Typography.Text>
            <Typography.Text type="secondary" className="kx:text-xs">
              Select code in the editor, then click <b>✎ Add note</b> or press {ADD_NOTE_KEYS}.
              Notes are markdown and stay pinned to their code.
            </Typography.Text>
          </div>
        ) : files.length === 0 ? (
          <Typography.Text
            type="secondary"
            className="kx:block kx:px-4 kx:py-6 kx:text-center kx:text-xs"
          >
            No notes match “{query.trim()}”.
          </Typography.Text>
        ) : (
          files.map((file) => {
            const inFile = shown
              .filter(({ note }) => note.file === file)
              .sort((a, b) => a.anchor.start - b.anchor.start);
            return (
              <section key={file} aria-label={`Notes in ${file}`} className="kx:pb-1">
                <div className="kx:flex kx:items-center kx:gap-1.5 kx:px-3 kx:pt-2 kx:pb-1 kx:text-xs kx:text-text-muted">
                  <FileTypeIcon path={file} size={14} />
                  <span
                    className={`kx:min-w-0 kx:flex-1 kx:truncate ${file === activeFile ? "kx:font-medium kx:text-text" : ""}`}
                    title={file}
                  >
                    {file}
                  </span>
                  <span>{inFile.length}</span>
                </div>
                <ul className="kx:m-0 kx:list-none kx:p-0">
                  {inFile.map(({ note, anchor }) => {
                    const stale = anchor.status === "outdated" || anchor.status === "missing";
                    const selected = note.id === selectedId;
                    const rest = excerpt(note.body);
                    return (
                      <li key={note.id}>
                        <button
                          type="button"
                          aria-current={selected || undefined}
                          onClick={() => onOpen(note.id)}
                          className={`kx:relative kx:flex kx:w-full kx:cursor-pointer kx:flex-col kx:gap-0.5 kx:border-0 kx:py-1.5 kx:pr-3 kx:pl-8 kx:text-left ${
                            selected
                              ? "kx:bg-primary/12 kx:before:absolute kx:before:inset-y-0 kx:before:left-0 kx:before:w-0.5 kx:before:bg-primary"
                              : "kx:bg-transparent kx:hover:bg-fill"
                          }`}
                        >
                          <span className="kx:flex kx:items-center kx:gap-1.5">
                            <span className="kx:min-w-0 kx:flex-1 kx:truncate kx:text-[13px] kx:text-text">
                              {noteTitle(note.body)}
                            </span>
                            {stale && (
                              <Tooltip
                                title={
                                  anchor.status === "missing"
                                    ? "The file is gone"
                                    : "The code changed since this note was written"
                                }
                              >
                                <span className="kx:inline-flex kx:text-warning">
                                  <IconAlertTriangle size={13} />
                                </span>
                              </Tooltip>
                            )}
                            <span className="kx:shrink-0 kx:font-mono kx:text-[11px] kx:text-text-muted">
                              {anchor.start === anchor.end
                                ? `L${anchor.start}`
                                : `L${anchor.start}–${anchor.end}`}
                            </span>
                          </span>
                          {rest && (
                            <span className="kx:truncate kx:text-xs kx:text-text-muted">
                              {rest}
                            </span>
                          )}
                          <span className="kx:sr-only">{lineLabel(anchor)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
      <div
        className={`kx:flex kx:h-7 kx:shrink-0 kx:items-center kx:gap-1.5 kx:px-3 kx:text-[11px] kx:text-text-muted ${borderT}`}
      >
        <span>
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </span>
        <span aria-hidden>·</span>
        <span className="kx:min-w-0 kx:flex-1 kx:truncate">saved in the database</span>
        {orphaned > 0 && (
          <Popconfirm
            title={`Delete ${orphaned} ${orphaned === 1 ? "note" : "notes"} whose file is gone?`}
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={onDeleteOrphaned}
          >
            <Tooltip title="Delete the notes whose file is gone">
              <Button
                type="text"
                size="small"
                danger
                className="kx:h-5 kx:shrink-0 kx:px-1 kx:text-[11px]"
                icon={<IconTrash size={12} />}
              >
                {orphaned} orphaned
              </Button>
            </Tooltip>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}
