import type { Actor } from "./Actor.js";

export type RequestContext = Readonly<{ requestId: string; actor: Actor }>;
/** Stable keys for future Kushibot scope mapping; no runtime dependency. */
export type WorkspaceScope = Readonly<{
  actorId: string;
  project_id: string;
  workspace_key: string;
}>;
