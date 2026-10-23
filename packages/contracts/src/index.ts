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
