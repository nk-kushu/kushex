import { PluginsPage } from "../plugins/PluginsPage";
import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { AgentsPage } from "../agents/AgentsPage";
import { ChatThreadsScreen } from "../chat/ChatThreadsScreen";
import { DebugEventsScreen } from "../debug-events/DebugEventsScreen";
import { FilesMain } from "../files/FilesMain";
import { FilesSide } from "../files/FilesSide";
import { NotesMain } from "../notes/NotesMain";
import { NotesSide, notes } from "../notes/NotesSide";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { TasksScreen } from "../tasks/TasksScreen";
import { paths } from "./navigation";
import { Panes } from "./Panes";
import { mobileViewChanged, projectOpened, selectProjectId } from "./workbenchSlice";

/** Files of the project in the URL; opening the URL directly opens that project. */
function ProjectFilesPage() {
  const dispatch = useAppDispatch();
  const { projectId = "" } = useParams();
  const current = useAppSelector(selectProjectId);
  useEffect(() => {
    if (current !== projectId) dispatch(projectOpened(projectId));
  }, [current, projectId, dispatch]);
  // Wait for the store to follow the URL, so no pane renders the previous project.
  if (current !== projectId) return null;
  return <Panes side={<FilesSide />} main={<FilesMain />} chat />;
}

function ChatThreadsPage() {
  const dispatch = useAppDispatch();
  const { projectId = "" } = useParams();
  const current = useAppSelector(selectProjectId);
  useEffect(() => {
    if (current !== projectId) dispatch(projectOpened(projectId));
  }, [current, projectId, dispatch]);
  if (current !== projectId) return null;
  return <Panes main={<ChatThreadsScreen projectId={projectId} />} chat />;
}

/** A chat run's debug events, next to the project's chat so new runs stay in reach. */
function RunDebugEventsPage() {
  const dispatch = useAppDispatch();
  const { projectId = "", runId = "" } = useParams();
  const current = useAppSelector(selectProjectId);
  useEffect(() => {
    if (current !== projectId) dispatch(projectOpened(projectId));
  }, [current, projectId, dispatch]);
  if (current !== projectId) return null;
  return (
    <Panes main={<DebugEventsScreen key={runId} projectId={projectId} runId={runId} />} chat />
  );
}

/** Files without a project in the URL: the open project's files, or an empty tree. */
function FilesPage() {
  const projectId = useAppSelector(selectProjectId);
  if (projectId) return <Navigate to={paths.files(projectId)} replace />;
  return <Panes side={<FilesSide />} main={<FilesMain />} chat />;
}

function NotesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { noteId } = useParams();
  const note = notes.find((item) => item.key === noteId);
  if (!note) return <Navigate to={paths.notes(notes[0]!.key)} replace />;
  return (
    <Panes
      side={
        <NotesSide
          selected={note.key}
          onSelect={(key) => {
            void navigate(paths.notes(key));
            dispatch(mobileViewChanged("main"));
          }}
        />
      }
      main={<NotesMain key={note.key} title={note.title} />}
      chat
    />
  );
}

export function WorkbenchRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to={paths.projects()} replace />} />
      <Route path="projects" element={<Panes main={<ProjectsScreen />} />} />
      <Route path="projects/:projectId/files" element={<ProjectFilesPage />} />
      <Route path="projects/:projectId/chat-threads" element={<ChatThreadsPage />} />
      <Route path="projects/:projectId/runs/:runId/debug-events" element={<RunDebugEventsPage />} />
      <Route path="files" element={<FilesPage />} />
      <Route path="tasks/:taskId?" element={<Panes main={<TasksScreen />} />} />
      <Route path="notes/:noteId?" element={<NotesPage />} />
      <Route path="agents/:agentName?" element={<AgentsPage />} />
      <Route path="plugins/:pluginId?" element={<Panes main={<PluginsPage />} />} />
      <Route path="settings" element={<Panes main={<SettingsScreen />} />} />
      <Route path="*" element={<Navigate to={paths.projects()} replace />} />
    </Routes>
  );
}
