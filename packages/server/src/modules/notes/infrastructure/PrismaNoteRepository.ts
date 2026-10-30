import type { NoteDto, NoteSummaryDto } from "@kushex/contracts";
import type { Note, PrismaClient } from "../../../generated/prisma/client.js";
import type { NoteChange, NoteRepository } from "../application/NoteRepository.js";

export class PrismaNoteRepository implements NoteRepository {
  private readonly listLimit = 500;
  constructor(private readonly client: PrismaClient) {}

  async list(actorId: string, query: string | null): Promise<readonly NoteSummaryDto[]> {
    const rows = await this.client.note.findMany({
      where: {
        actorId,
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { content: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, title: true, pinned: true, updatedAt: true },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: this.listLimit,
    });
    return rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.toISOString() }));
  }

  async find(actorId: string, id: string): Promise<NoteDto | null> {
    const row = await this.client.note.findFirst({ where: { id, actorId } });
    return row ? this.toDto(row) : null;
  }

  async create(actorId: string, title: string, content: string): Promise<NoteDto> {
    return this.toDto(await this.client.note.create({ data: { actorId, title, content } }));
  }

  async update(actorId: string, id: string, change: NoteChange): Promise<NoteDto | null> {
    const { content, pinned } = change;
    // Compare and set in one statement, so of two saves from the same revision one fails.
    const { count } = await this.client.note.updateMany({
      where: { id, actorId, ...(content ? { revision: content.baseRevision } : {}) },
      data: {
        ...(pinned === undefined ? {} : { pinned }),
        ...(content
          ? { content: content.text, title: content.title, revision: { increment: 1 } }
          : {}),
      },
    });
    return count === 1 ? this.find(actorId, id) : null;
  }

  async delete(actorId: string, id: string): Promise<boolean> {
    const { count } = await this.client.note.deleteMany({ where: { id, actorId } });
    return count === 1;
  }

  private toDto(row: Note): NoteDto {
    const { id, title, content, pinned, revision, createdAt, updatedAt } = row;
    return {
      id,
      title,
      content,
      pinned,
      revision,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }
}
