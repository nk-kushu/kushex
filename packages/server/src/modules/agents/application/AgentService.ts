import type {
  AgentDto,
  AgentFileDto,
  AgentSummaryDto,
  LibraryTypesDto,
  NodeTypesDto,
} from "@kushex/contracts";
import { AgentFilePath } from "../domain/AgentFilePath.js";
import { AgentName } from "../domain/AgentName.js";
import type { AgentEntry, AgentStore } from "./AgentStore.js";
import type { LibraryTypesSource, NodeTypesSource } from "./LibraryTypesSource.js";

export class AgentService {
  constructor(
    private readonly agents: AgentStore,
    private readonly libraryTypes: LibraryTypesSource,
    private readonly runtimeTypes: NodeTypesSource,
  ) {}

  list(): Promise<readonly AgentSummaryDto[]> {
    return this.agents.list();
  }

  find(name: string): Promise<AgentDto> {
    return this.agents.find(new AgentName(name));
  }

  entry(name: string): Promise<AgentEntry> {
    return this.agents.entry(new AgentName(name));
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

  watch(name: string, onChange: () => void, onError: (error: unknown) => void) {
    return this.agents.watch(new AgentName(name), onChange, onError);
  }

  types(): Promise<LibraryTypesDto> {
    return this.libraryTypes.read();
  }

  nodeTypes(): Promise<NodeTypesDto> {
    return this.runtimeTypes.read();
  }
}
