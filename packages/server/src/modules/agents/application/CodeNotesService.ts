import type { AgentCodeNotesDto } from "@kushex/contracts";
import { ConflictError } from "../../../errors/ConflictError.js";
import type { AgentService } from "./AgentService.js";
import type { CodeNotesRepository } from "./CodeNotesRepository.js";

export class CodeNotesService {
  constructor(
    private readonly notes: CodeNotesRepository,
    private readonly agents: AgentService,
  ) {}

  async find(name: string): Promise<AgentCodeNotesDto> {
    // Fails with not found for an agent that does not exist.
    await this.agents.entry(name);
    return (await this.notes.find(name)) ?? { content: "", revision: 0 };
  }

  async save(name: string, content: string, baseRevision: number): Promise<AgentCodeNotesDto> {
    await this.agents.entry(name);
    const saved = await this.notes.save(name, content, baseRevision);
    if (!saved)
      throw new ConflictError(`The notes of "${name}" changed since they were loaded.`);
    return saved;
  }
}
