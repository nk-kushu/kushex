import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { WorkspaceService } from "../../workspaces/public.js";
import type { ProjectRepository } from "./ProjectRepository.js";

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly workspaces: WorkspaceService,
  ) {}
  async find(context: RequestContext, id: string): Promise<ProjectDto> {
    const project = await this.repository.find(context.actor.id, id);
    if (!project) throw new NotFoundError("Project not found.");
    return project;
  }
  async create(context: RequestContext, input: CreateProjectRequest): Promise<ProjectDto> {
    await this.workspaces.validateLocation(context, input.path);
    return this.repository.create(context.actor.id, input);
  }
  list(context: RequestContext, offset: number): Promise<Page<ProjectDto>> {
    return this.repository.list(context.actor.id, offset);
  }
}
