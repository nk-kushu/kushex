import type { NoteDto } from "@kushex/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import { useUpdateNoteMutation } from "../../shared/api/kushexApi";

export type SaveStatus = "saved" | "unsaved" | "saving" | "failed";

const SAVE_DELAY_MS = 800;

/**
 * The draft of a note, saved a moment after typing stops, when the editor closes, and on
 * `flush`. Each save is based on the revision the previous one returned; edits made while a
 * save runs are saved after it.
 */
export function useNoteAutosave(note: NoteDto) {
  const [updateNote] = useUpdateNoteMutation();
  const [text, setText] = useState(note.content);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(text);
  const saved = useRef({ content: note.content, revision: note.revision });
  const saving = useRef(false);
  /** Set once the note is deleted, so closing the editor does not save it again. */
  const discarded = useRef(false);

  const flush = useCallback(async (): Promise<void> => {
    if (saving.current || discarded.current) return;
    saving.current = true;
    try {
      // Edits made while a save runs are saved by the next round.
      while (!discarded.current && latest.current !== saved.current.content) {
        setStatus("saving");
        const result = await updateNote({
          id: note.id,
          content: latest.current,
          baseRevision: saved.current.revision,
        }).unwrap();
        saved.current = { content: result.content, revision: result.revision };
        setError(null);
      }
      setStatus("saved");
    } catch (failure) {
      setError(errorMessage(failure));
      setStatus("failed");
    } finally {
      saving.current = false;
    }
  }, [note.id, updateNote]);

  const change = (next: string) => {
    latest.current = next;
    setText(next);
    if (next !== saved.current.content) setStatus("unsaved");
  };

  useEffect(() => {
    if (text === saved.current.content) return;
    const timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, flush]);

  // Save what is left when the editor closes, and warn before the page unloads with edits.
  useEffect(() => () => void flush(), [flush]);
  const pending = status !== "saved";
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return {
    text,
    change,
    status,
    error,
    flush,
    discard: () => {
      discarded.current = true;
    },
  };
}
