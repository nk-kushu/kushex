import type { DirectoryPageDto, FileContentDto } from "@kushex/contracts";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { WorkspaceFileSystem, WorkspaceService } from "../../workspaces/public.js";

export class FileService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly filesystem: WorkspaceFileSystem,
  ) {}
  async tree(
    context: RequestContext,
    projectId: string,
    path: string,
    offset: number,
  ): Promise<DirectoryPageDto> {
    const { workspace } = await this.workspaces.forProject(context, projectId);
    return this.filesystem.tree(workspace.path, path, offset);
  }
  async file(context: RequestContext, projectId: string, path: string): Promise<FileContentDto> {
    const { workspace } = await this.workspaces.forProject(context, projectId);
    return this.filesystem.file(workspace.path, path);
  }
}
