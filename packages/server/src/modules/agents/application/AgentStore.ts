import type { AgentDto, AgentFileDto, AgentSummaryDto } from "@kushex/contracts";
import type { AgentFilePath } from "../domain/AgentFilePath.js";
import type { AgentName } from "../domain/AgentName.js";

/** Agents as source: one folder per agent with a primary file that exports it. */
/** Where an agent's code lives on disk, for running it. */
export type AgentEntry = Readonly<{
  /** Real path of the agent folder. */
  directory: string;
  /** Absolute path of the primary file. */
  primaryFile: string;
}>;

export interface AgentStore {
  list(): Promise<readonly AgentSummaryDto[]>;
  /** The agent with every file in its folder. */
  find(name: AgentName): Promise<AgentDto>;
  entry(name: AgentName): Promise<AgentEntry>;
  /** Creates the folder and its primary file; fails with a conflict when the agent exists. */
  create(name: AgentName, primarySource: string): Promise<AgentDto>;
  /** Adds a file to an existing agent; fails with a conflict when the path is taken. */
  createFile(name: AgentName, path: AgentFilePath, content: string): Promise<AgentFileDto>;
  /** Fails with a conflict when the stored revision is not `baseRevision`. */
  updateFile(
    name: AgentName,
    path: AgentFilePath,
    content: string,
    baseRevision: string,
  ): Promise<AgentFileDto>;
  /**
   * Calls `onChange` (coalesced) whenever something in the agent folder changes, and
   * `onError` once if watching stops; the returned function stops watching.
   */
  watch(
    name: AgentName,
    onChange: () => void,
    onError: (error: unknown) => void,
  ): Promise<() => void>;
}
