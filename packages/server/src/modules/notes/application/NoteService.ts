import type { NoteDto, NoteSummaryDto, UpdateNoteRequest } from "@kushex/contracts";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import { NoteTitle } from "../domain/NoteTitle.js";
import type { NoteRepository } from "./NoteRepository.js";

export class NoteService {
  constructor(private readonly repository: NoteRepository) {}

  list(context: RequestContext, query: string | null): Promise<readonly NoteSummaryDto[]> {
    return this.repository.list(context.actor.id, query);
  }

  async find(context: RequestContext, id: string): Promise<NoteDto> {
    const note = await this.repository.find(context.actor.id, id);
    if (!note) throw new NotFoundError("Note not found.");
    return note;
  }

  create(context: RequestContext, content: string): Promise<NoteDto> {
    return this.repository.create(context.actor.id, new NoteTitle(content).value, content);
  }

  async update(context: RequestContext, id: string, input: UpdateNoteRequest): Promise<NoteDto> {
    const updated = await this.repository.update(context.actor.id, id, {
      pinned: input.pinned,
      content:
        input.content === undefined
          ? undefined
          : {
              text: input.content,
              title: new NoteTitle(input.content).value,
              baseRevision: input.baseRevision,
            },
    });
    if (updated) return updated;
    // Tell a missing note from a stale revision.
    await this.find(context, id);
    throw new ConflictError("The note changed since it was loaded.");
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    if (!(await this.repository.delete(context.actor.id, id)))
      throw new NotFoundError("Note not found.");
  }
}
