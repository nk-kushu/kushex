import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { AgentRun } from "../application/AgentRun.js";
import type { DebugStreamRef } from "../application/DebugEventLog.js";
import type {
  DebugStreamRepository,
  RecordedRunDto,
} from "../application/DebugStreamRepository.js";

export class PrismaDebugStreamRepository implements DebugStreamRepository {
  constructor(private readonly client: PrismaClient) {}

  async claim(run: AgentRun, stream: DebugStreamRef): Promise<boolean> {
    const key = {
      scopeId: stream.scope.scopeId,
      scopeProjectId: stream.scope.projectId,
      streamId: stream.streamId,
    };
    // Insert-if-absent, then check the owner, so two runs racing for one stream cannot share it.
    await this.client.agentRunDebugStream.createMany({
      data: [
        {
          ...key,
          workspaceId: stream.scope.workspaceId ?? null,
          runId: run.id,
          actorId: run.actorId,
          projectId: run.projectId,
          agentName: run.agentName,
          runStartedAt: run.startedAt,
        },
      ],
      skipDuplicates: true,
    });
    const owner = await this.client.agentRunDebugStream.findUnique({
      where: { scopeId_scopeProjectId_streamId: key },
      select: { runId: true },
    });
    return owner?.runId === run.id;
  }

  async forRun(
    runId: string,
  ): Promise<Readonly<{ run: RecordedRunDto | null; streams: readonly DebugStreamRef[] }>> {
    const rows = await this.client.agentRunDebugStream.findMany({
      where: { runId },
      orderBy: [{ createdAt: "asc" }, { streamId: "asc" }],
      take: 100,
    });
    const first = rows[0];
    return {
      run: first
        ? {
            id: first.runId,
            actorId: first.actorId,
            projectId: first.projectId,
            agentName: first.agentName,
            startedAt: first.runStartedAt,
          }
        : null,
      streams: rows.map((row) => ({
        scope: {
          scopeId: row.scopeId,
          projectId: row.scopeProjectId,
          ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
        },
        streamId: row.streamId,
      })),
    };
  }
}
