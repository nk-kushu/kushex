import { Button, Empty } from "antd";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import { useCreateNoteMutation, useNotesQuery } from "../../shared/api/kushexApi";
import { paths } from "../workbench/navigation";
import { Panes } from "../workbench/Panes";
import { mobileViewChanged } from "../workbench/workbenchSlice";
import { NEW_NOTE } from "./noteTitle";
import { NotesMain } from "./NotesMain";
import { NotesSide } from "./NotesSide";

const SEARCH_DELAY_MS = 250;

/** Markdown notes, e.g. on learning kushibot: a searchable list and the open note. */
export function NotesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { noteId } = useParams();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const notes = useNotesQuery(search, { refetchOnMountOrArgChange: true });
  const [createNote, creating] = useCreateNoteMutation();
  const [createError, setCreateError] = useState<string | null>(null);

  const open = (id: string, replace = false) => {
    void navigate(paths.notes(id), { replace });
    dispatch(mobileViewChanged("main"));
  };
  const create = async () => {
    try {
      setQuery("");
      open((await createNote({ content: NEW_NOTE }).unwrap()).id);
      setCreateError(null);
    } catch (failure) {
      setCreateError(errorMessage(failure));
    }
  };

  // Without a note in the URL, open the first one; after a delete, of the refetched list.
  const first = notes.isFetching ? undefined : notes.data?.[0];
  if (!noteId && !search && first) return <Navigate to={paths.notes(first.id)} replace />;

  return (
    <Panes
      side={
        <NotesSide
          notes={notes.data}
          error={createError ?? (notes.isError ? errorMessage(notes.error) : null)}
          selected={noteId}
          query={query}
          creating={creating.isLoading}
          onQuery={setQuery}
          onSelect={(id) => open(id)}
          onCreate={() => void create()}
        />
      }
      main={
        noteId ? (
          <NotesMain key={noteId} id={noteId} onDeleted={() => void navigate(paths.notes(), { replace: true })} />
        ) : (
          <Empty className="kx:mt-16" description="Write notes as you learn kushibot">
            <Button type="primary" loading={creating.isLoading} onClick={() => void create()}>
              New note
            </Button>
          </Empty>
        )
      }
      chat
    />
  );
}
