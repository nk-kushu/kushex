import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { WorkspaceRepository } from "../application/WorkspaceRepository.js";
import type { Workspace } from "../domain/Workspace.js";

export class PrismaWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly client: PrismaClient) {}
  findForProject(projectId: string, actorId: string): Promise<Workspace | null> {
    return this.client.workspace.findFirst({ where: { projectId, project: { actorId } } });
  }
}
