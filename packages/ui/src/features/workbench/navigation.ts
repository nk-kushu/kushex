import { matchPath, useLocation, useNavigate } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { fileTabOpened, projectOpened, selectProjectId, type FileTab } from "./workbenchSlice";

export type Activity = "projects" | "files" | "tasks" | "notes" | "agents" | "settings";

/** Every page of the panel has its own route; build links only through these helpers. */
export const paths = {
  projects: () => "/projects",
  /** Files of a project, or the empty Files page when no project is open. */
  files: (projectId?: string | null) =>
    projectId ? `/projects/${encodeURIComponent(projectId)}/files` : "/files",
  tasks: (taskId?: string) => (taskId ? `/tasks/${encodeURIComponent(taskId)}` : "/tasks"),
  notes: (noteId?: string) => (noteId ? `/notes/${encodeURIComponent(noteId)}` : "/notes"),
  agents: (name?: string) => (name ? `/agents/${encodeURIComponent(name)}` : "/agents"),
  settings: () => "/settings",
} as const;

const activityPatterns: readonly [Activity, string][] = [
  ["files", "/projects/:projectId/files/*"],
  ["files", "/files/*"],
  ["projects", "/projects/*"],
  ["tasks", "/tasks/*"],
  ["notes", "/notes/*"],
  ["agents", "/agents/*"],
  ["settings", "/settings/*"],
];

/** The activity of the current route. */
export function useActivity(): Activity {
  const { pathname } = useLocation();
  return activityPatterns.find(([, pattern]) => matchPath(pattern, pathname))?.[0] ?? "projects";
}

/** Open a project and go to its files. */
export function useOpenProject() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  return (projectId: string) => {
    dispatch(projectOpened(projectId));
    void navigate(paths.files(projectId));
  };
}

/** Open a tab in the Files page, going there from any other page. */
export function useOpenFileTab() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const projectId = useAppSelector(selectProjectId);
  const activity = useActivity();
  return (tab: FileTab) => {
    dispatch(fileTabOpened(tab));
    if (activity !== "files") void navigate(paths.files(projectId));
  };
}
