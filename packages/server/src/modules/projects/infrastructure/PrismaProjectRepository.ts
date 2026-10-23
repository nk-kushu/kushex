import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";
import type { PrismaClient, Prisma } from "../../../generated/prisma/client.js";
import type { ProjectRepository } from "../application/ProjectRepository.js";

export class PrismaProjectRepository implements ProjectRepository {
  private readonly pageSize = 100;
  constructor(private readonly client: PrismaClient) {}
  async find(actorId: string, id: string): Promise<ProjectDto | null> {
    const row = await this.client.project.findFirst({
      where: { id, actorId },
      include: { workspace: true },
    });
    return row ? this.toDto(row) : null;
  }
  async create(actorId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    // Nested create is atomic: a workspace cannot be committed without its project.
    const project = await this.client.project.create({
      data: {
        actorId,
        name: input.name,
        description: input.description ?? null,
        workspace: { create: { path: input.path } },
      },
      include: { workspace: true },
    });
    return this.toDto(project);
  }
  async list(actorId: string, offset: number): Promise<Page<ProjectDto>> {
    const rows = await this.client.project.findMany({
      where: { actorId },
      include: { workspace: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: this.pageSize + 1,
    });
    return {
      entries: rows.slice(0, this.pageSize).map((row) => this.toDto(row)),
      nextOffset: rows.length > this.pageSize ? offset + this.pageSize : null,
    };
  }
  private toDto(project: Prisma.ProjectGetPayload<{ include: { workspace: true } }>): ProjectDto {
    if (!project.workspace) throw new Error("Project is missing its workspace.");
    const { id, name, description, createdAt, workspace } = project;
    return {
      id,
      name,
      description,
      createdAt: createdAt.toISOString(),
      workspace: {
        id: workspace.id,
        path: workspace.path,
        branch: workspace.branch,
        revision: workspace.revision,
      },
    };
  }
}
