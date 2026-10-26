import type { LibraryTypesDto } from "@kushex/contracts";

/** Declaration files the agent editor uses to type-check `import ... from "kushibot"`. */
export interface LibraryTypesSource {
  read(): Promise<LibraryTypesDto>;
}
