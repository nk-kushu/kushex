import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";

export interface ProjectRepository {
  find(actorId: string, id: string): Promise<ProjectDto | null>;
  create(actorId: string, input: CreateProjectRequest): Promise<ProjectDto>;
  list(actorId: string, offset: number): Promise<Page<ProjectDto>>;
}
