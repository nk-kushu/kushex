export type Workspace = Readonly<{
  id: string;
  projectId: string;
  path: string;
  branch: string | null;
  revision: string | null;
}>;
