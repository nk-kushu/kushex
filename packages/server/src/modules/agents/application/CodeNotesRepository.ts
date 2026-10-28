import type { AgentCodeNotesDto } from "@kushex/contracts";

/** Each agent's code notes, kept as one markdown document. */
export interface CodeNotesRepository {
  /** Null while the agent has no notes. */
  find(agentName: string): Promise<AgentCodeNotesDto | null>;
  /** Null when the stored revision is not `baseRevision` (0: no notes stored yet). */
  save(agentName: string, content: string, baseRevision: number): Promise<AgentCodeNotesDto | null>;
}
