/** Browser-safe JSON contracts. Filesystem contents are live read projections. */
export type WorkspaceDto = Readonly<{
  id: string;
  path: string;
  branch: string | null;
  revision: string | null;
}>;
export type ProjectDto = Readonly<{
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  workspace: WorkspaceDto;
}>;
export type CreateProjectRequest = Readonly<{ name: string; path: string; description?: string }>;
export type Page<T> = Readonly<{ entries: readonly T[]; nextOffset: number | null }>;
export type DirectoryEntryDto = Readonly<{
  name: string;
  path: string;
  kind: "directory" | "file";
}>;
export type DirectoryPageDto = Page<DirectoryEntryDto>;
export type FileContentDto = Readonly<{ path: string; size: number }> &
  (Readonly<{ kind: "text"; content: string }> | Readonly<{ kind: "binary" }>);
export type ApiErrorDto = Readonly<{ code: string; message: string; details?: readonly unknown[] }>;

/** Splitter id → each panel's share of the splitter (0–1, summing to 1). */
export type SplitterSizesDto = Readonly<Record<string, readonly number[]>>;

export type UserSettingsDto = Readonly<{
  colorMode: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  splitterSizes: SplitterSizesDto;
}>;
/** `splitterSizes` merges by splitter id: ids left out keep their saved sizes. */
export type UpdateUserSettingsRequest = Partial<UserSettingsDto>;

/** An agent is a folder `agents/<name>/` whose primary file `agent.ts` exports a kushibot-based agent. */
export type AgentSummaryDto = Readonly<{ name: string; updatedAt: string }>;
/**
 * One file in an agent folder; `path` is relative to the folder, e.g. `prompts/review.md`.
 * Only text files within the size limit carry content and can be edited.
 */
export type AgentFileDto = Readonly<{ path: string; size: number; updatedAt: string }> &
  (
    | Readonly<{
        kind: "text";
        content: string;
        /** Content hash; a save must name the revision it was based on. */
        revision: string;
      }>
    | Readonly<{ kind: "binary" | "too-large" }>
  );
export type AgentDto = Readonly<{
  name: string;
  /** Path of the file that exports the agent, relative to the folder. */
  primaryFile: string;
  updatedAt: string;
  files: readonly AgentFileDto[];
}>;
/** Lowercase letters, digits and dashes, starting with a letter (at most 63 characters). */
export type CreateAgentRequest = Readonly<{ name: string }>;
/** Folder-relative path; segments use letters, digits, `.`, `_` and `-` and cannot start with a dot. */
export type CreateAgentFileRequest = Readonly<{ path: string }>;
export type UpdateAgentFileRequest = Readonly<{
  path: string;
  content: string;
  baseRevision: string;
}>;

/** Declaration files of the kushibot library, for editor type checking. */
export type LibraryTypesDto = Readonly<{
  packageName: string;
  version: string | null;
  /** Paths relative to the package's declaration root, e.g. `index.d.ts`. */
  files: readonly Readonly<{ path: string; content: string }>[];
}>;
