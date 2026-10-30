import type { LibraryTypesDto, NodeTypesDto } from "@kushex/contracts";

/** Declaration files the agent editor uses to type-check `import ... from "kushibot"`. */
export interface LibraryTypesSource {
  read(): Promise<LibraryTypesDto>;
}

/** Declaration files the agent editor uses to type-check Node's modules and globals. */
export interface NodeTypesSource {
  read(): Promise<NodeTypesDto>;
}
