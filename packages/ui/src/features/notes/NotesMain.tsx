import type { NoteDto } from "@kushex/contracts";
import { IconCode, IconEye } from "@tabler/icons-react";
import { Alert, Button, Input, Popconfirm, Segmented, Spin, Tooltip, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useDeleteNoteMutation,
  useNoteQuery,
  useUpdateNoteMutation,
} from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { FillTabs } from "../../shared/components/FillTabs";
import { Markdown } from "../../shared/components/Markdown";
import { PinIcon, RemoveIcon, UnpinIcon } from "../../shared/lib/icons";
import { NEW_NOTE, noteTitle } from "./noteTitle";
import { useNoteAutosave, type SaveStatus } from "./useNoteAutosave";

const statusLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Not saved",
};

/** The note in the URL, loaded fresh each time it opens. */
export function NotesMain({ id, onDeleted }: Readonly<{ id: string; onDeleted: () => void }>) {
  const note = useNoteQuery(id, { refetchOnMountOrArgChange: true });
  /** Bumped by "Reload note", which replaces the draft with the stored note. */
  const [loads, setLoads] = useState(0);
  if (note.isError)
    return <Alert className="kx:m-3" type="error" showIcon message={errorMessage(note.error)} />;
  // Only the first load seeds the draft; a refetch while open must not replace it.
  if (!note.data || note.data.id !== id)
    return <Spin className="kx:mt-8 kx:w-full" aria-label="Loading note" />;
  return (
    <NoteEditor
      key={loads}
      note={note.data}
      onDeleted={onDeleted}
      onReload={async () => {
        await note.refetch();
        setLoads((value) => value + 1);
      }}
    />
  );
}

/** The note as markdown to edit or as its preview; edits save themselves. */
function NoteEditor({
  note,
  onDeleted,
  onReload,
}: Readonly<{ note: NoteDto; onDeleted: () => void; onReload: () => Promise<void> }>) {
  const draft = useNoteAutosave(note);
  const [pinned, setPinned] = useState(note.pinned);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateNote, pinning] = useUpdateNoteMutation();
  const [deleteNote, deleting] = useDeleteNoteMutation();
  // A fresh note opens for writing, an existing one for reading.
  const [view, setView] = useState<"preview" | "edit">(
    note.content === NEW_NOTE ? "edit" : "preview",
  );

  const togglePin = async () => {
    try {
      setPinned((await updateNote({ id: note.id, pinned: !pinned }).unwrap()).pinned);
      setActionError(null);
    } catch (failure) {
      setActionError(errorMessage(failure));
    }
  };
  const remove = async () => {
    try {
      draft.discard();
      await deleteNote(note.id).unwrap();
      onDeleted();
    } catch (failure) {
      setActionError(errorMessage(failure));
    }
  };

  const toolbar = (
    <div className="kx:flex kx:items-center kx:gap-1 kx:px-2">
      <Segmented<"preview" | "edit">
        size="small"
        aria-label="Note view"
        className="kx:mr-1"
        value={view}
        onChange={setView}
        options={[
          { value: "preview", label: "Preview", icon: <IconEye size={14} /> },
          { value: "edit", label: "Edit", icon: <IconCode size={14} /> },
        ]}
      />
      <Typography.Text
        type={draft.status === "failed" ? "danger" : "secondary"}
        className="kx:text-xs"
        role="status"
        aria-label="Save status"
      >
        {statusLabels[draft.status]}
      </Typography.Text>
      <Tooltip title={pinned ? "Unpin" : "Pin to top"}>
        <Button
          type="text"
          size="small"
          loading={pinning.isLoading}
          onClick={() => void togglePin()}
          icon={
            <AppIcon
              icon={pinned ? UnpinIcon : PinIcon}
              label={pinned ? "Unpin note" : "Pin note"}
            />
          }
        />
      </Tooltip>
      <Popconfirm
        title="Delete this note?"
        okText="Delete"
        okButtonProps={{ danger: true }}
        onConfirm={() => remove()}
      >
        <Button
          type="text"
          size="small"
          danger
          loading={deleting.isLoading}
          icon={<AppIcon icon={RemoveIcon} label="Delete note" />}
        />
      </Popconfirm>
    </div>
  );

  return (
    <div className="kx:flex kx:h-full kx:flex-col">
      {(draft.error ?? actionError) && (
        <Alert
          type="error"
          showIcon
          banner
          message={draft.error ?? actionError}
          action={
            draft.error ? (
              <Button
                size="small"
                onClick={() => {
                  draft.discard();
                  void onReload();
                }}
              >
                Reload note
              </Button>
            ) : undefined
          }
        />
      )}
      <div className="kx:min-h-0 kx:flex-1">
        <FillTabs
          type="card"
          size="small"
          tabBarExtraContent={toolbar}
          items={[
            {
              key: "note",
              label: noteTitle(draft.text),
              children:
                view === "edit" ? (
                  <Input.TextArea
                    autoFocus
                    aria-label="Note text"
                    variant="borderless"
                    value={draft.text}
                    onChange={(event) => draft.change(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                        event.preventDefault();
                        void draft.flush();
                      }
                    }}
                    className="kx:h-full kx:bg-surface kx:font-mono"
                    style={{ resize: "none" }}
                  />
                ) : (
                  <div
                    className="kx:h-full kx:overflow-auto kx:bg-surface kx:p-3"
                    aria-label="Note preview"
                    role="region"
                  >
                    <Markdown text={draft.text} />
                  </div>
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}
