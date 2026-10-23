import type { Workspace } from "../domain/Workspace.js";

export interface WorkspaceRepository {
  findForProject(projectId: string, actorId: string): Promise<Workspace | null>;
}
