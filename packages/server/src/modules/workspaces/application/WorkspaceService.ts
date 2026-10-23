import type { DirectoryPageDto } from "@kushex/contracts";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { RequestContext, WorkspaceScope } from "../../../shared/application/RequestContext.js";
import type { Workspace } from "../domain/Workspace.js";
import type { WorkspaceFileSystem } from "./WorkspaceFileSystem.js";
import type { WorkspaceRepository } from "./WorkspaceRepository.js";

export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly filesystem: WorkspaceFileSystem,
  ) {}
  locations(_context: RequestContext, offset: number): Promise<DirectoryPageDto> {
    return this.filesystem.locations(offset);
  }
  validateLocation(_context: RequestContext, relative: string): Promise<void> {
    return this.filesystem.validateLocation(relative);
  }
  async forProject(
    context: RequestContext,
    projectId: string,
  ): Promise<{ workspace: Workspace; scope: WorkspaceScope }> {
    const workspace = await this.repository.findForProject(projectId, context.actor.id);
    if (!workspace) throw new NotFoundError("Project workspace not found.");
    return {
      workspace,
      scope: { actorId: context.actor.id, project_id: projectId, workspace_key: workspace.id },
    };
  }
}
