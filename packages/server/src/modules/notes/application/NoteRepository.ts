import type { NoteDto, NoteSummaryDto } from "@kushex/contracts";

/** A change to a note; content is saved only when its base revision is still current. */
export type NoteChange = Readonly<{
  pinned?: boolean;
  content?: Readonly<{ text: string; title: string; baseRevision: number }>;
}>;

/** Each actor's markdown notes. */
export interface NoteRepository {
  /** Pinned notes first, then the most recently updated; `query` matches title or content. */
  list(actorId: string, query: string | null): Promise<readonly NoteSummaryDto[]>;
  find(actorId: string, id: string): Promise<NoteDto | null>;
  create(actorId: string, title: string, content: string): Promise<NoteDto>;
  /** Null when the note does not exist or its revision is no longer the change's base. */
  update(actorId: string, id: string, change: NoteChange): Promise<NoteDto | null>;
  /** False when the note does not exist. */
  delete(actorId: string, id: string): Promise<boolean>;
}
