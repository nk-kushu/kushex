import type { AgentCodeNotesDto } from "@kushex/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { CodeNotesRepository } from "../application/CodeNotesRepository.js";

const select = { content: true, revision: true } as const;

export class PrismaCodeNotesRepository implements CodeNotesRepository {
  constructor(private readonly client: PrismaClient) {}

  find(agentName: string): Promise<AgentCodeNotesDto | null> {
    return this.client.agentCodeNotes.findUnique({ where: { agentName }, select });
  }

  async save(
    agentName: string,
    content: string,
    baseRevision: number,
  ): Promise<AgentCodeNotesDto | null> {
    if (baseRevision === 0) {
      // Stored revisions start at 1, so a concurrent first save leaves the row as it is.
      const rows = await this.client.$queryRaw<AgentCodeNotesDto[]>`
        INSERT INTO "kushex"."AgentCodeNotes" ("agentName", "content", "revision", "updatedAt")
        VALUES (${agentName}, ${content}, 1, now())
        ON CONFLICT ("agentName") DO NOTHING
        RETURNING "content", "revision"`;
      return rows[0] ?? null;
    }
    // Compare and set in one statement, so of two saves from the same revision one fails.
    const { count } = await this.client.agentCodeNotes.updateMany({
      where: { agentName, revision: baseRevision },
      data: { content, revision: baseRevision + 1 },
    });
    return count === 1 ? { content, revision: baseRevision + 1 } : null;
  }
}
