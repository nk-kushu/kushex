import type { DirectoryPageDto, FileContentDto } from "@kushex/contracts";

export interface WorkspaceFileSystem {
  locations(offset: number): Promise<DirectoryPageDto>;
  validateLocation(relative: string): Promise<void>;
  tree(workspace: string, relative: string, offset: number): Promise<DirectoryPageDto>;
  file(workspace: string, relative: string): Promise<FileContentDto>;
}
