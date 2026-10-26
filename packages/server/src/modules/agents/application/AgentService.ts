import type { AgentDto, AgentFileDto, AgentSummaryDto, LibraryTypesDto } from "@kushex/contracts";
import { AgentFilePath } from "../domain/AgentFilePath.js";
import { AgentName } from "../domain/AgentName.js";
import type { AgentStore } from "./AgentStore.js";
import type { AgentTemplate } from "./AgentTemplate.js";
import type { LibraryTypesSource } from "./LibraryTypesSource.js";

export class AgentService {
  constructor(
    private readonly agents: AgentStore,
    private readonly template: AgentTemplate,
    private readonly libraryTypes: LibraryTypesSource,
  ) {}

  list(): Promise<readonly AgentSummaryDto[]> {
    return this.agents.list();
  }

  find(name: string): Promise<AgentDto> {
    return this.agents.find(new AgentName(name));
  }

  /** New agents start from a kushibot template that the user then edits. */
  create(name: string): Promise<AgentDto> {
    const agentName = new AgentName(name);
    return this.agents.create(agentName, this.template.render(agentName));
  }

  /** New files start empty. */
  createFile(name: string, path: string): Promise<AgentFileDto> {
    return this.agents.createFile(new AgentName(name), new AgentFilePath(path), "");
  }

  updateFile(
    name: string,
    path: string,
    content: string,
    baseRevision: string,
  ): Promise<AgentFileDto> {
    return this.agents.updateFile(
      new AgentName(name),
      new AgentFilePath(path),
      content,
      baseRevision,
    );
  }

  types(): Promise<LibraryTypesDto> {
    return this.libraryTypes.read();
  }
}
