import type { OnMount } from "@monaco-editor/react";
import type { editor, IPosition, IRange, Uri } from "monaco-editor";
import {
  Alert,
  Button,
  Dropdown,
  Segmented,
  Spin,
  Splitter,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import {
  IconArrowLeft,
  IconChevronRight,
  IconCode,
  IconDeviceFloppy,
  IconEye,
  IconLock,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AgentDto,
  AgentFileDto,
  DebugBreakpointDto,
  DebugCallFrameDto,
  LibraryTypesDto,
  NodeTypesDto,
} from "@kushex/contracts";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useAgentFilesQuery,
  useAgentNotesQuery,
  useAgentQuery,
  useKushibotTypesQuery,
  useLazyScriptSourceQuery,
  useNodeTypesQuery,
  useUpdateAgentFileMutation,
  useUpdateAgentNotesMutation,
} from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { CodeEditor, languageForPath } from "../../shared/components/CodeEditor";
import { borderB, borderL, borderR } from "../../shared/lib/styles";
import {
  breakpointsMoved,
  breakpointToggled,
  isFinished,
  selectAgentBreakpoints,
  selectDebugRun,
  selectSelectedFrame,
} from "../runs/runsSlice";
import { usePersistedSplitter } from "../settings/usePersistedSplitter";
import { EmptyMain } from "../workbench/EmptyMain";
import { useNarrow } from "../workbench/Panes";
import { AgentFiles } from "./AgentFiles";
import { AgentSwitcher } from "./AgentSwitcher";
import { BreakpointsSection } from "./debug/BreakpointsSection";
import { DebugConsole, DebugPanel } from "./debug/DebugPanel";
import { useDebugDecorations } from "./debug/useDebugDecorations";
import {
  agentFileUri,
  agentPathOf,
  configureAgentLanguage,
  disposeAgentModels,
  isLibraryUri,
  syncAgentModels,
  type Monaco,
} from "./agentLanguage";
import { FileTypeIcon } from "./fileIcons";
import {
  anchorNote,
  newNoteId,
  parseNotes,
  serializeNotes,
  type CodeNote,
} from "./notes/codeNotes";
import { NotePanel, type NoteView } from "./notes/NotePanel";
import { Markdown } from "../../shared/components/Markdown";
import { NotesList } from "./notes/NotesList";
import { selectedLines, useCodeNotes, type LineRange } from "./notes/useCodeNotes";
import { useResizableWidth } from "./notes/useResizableWidth";

/** The tabs of the side panel, like VS Code's Explorer and Run and Debug views. */
type SideTab = "files" | "notes" | "debug";
type TextFile = Extract<AgentFileDto, { kind: "text" }>;
/** Where a go-to-definition lands once its model is in the editor. */
type Reveal = { uri: string; target: IRange | IPosition };
/** A read-only file over `active`: a kushibot declaration file or a script the debugger is in. */
type Library = {
  uri: string;
  path: string;
  content: string;
  language?: string;
  /** Set for a script of a debug run. */
  scriptId?: string;
};
/** Model URIs of scripts shown while debugging. */
const SCRIPT_URI_PREFIX = "inmemory://kushex-script/";
const NO_LINES: readonly number[] = [];
const NO_BOUND: readonly DebugBreakpointDto[] = [];

/** Whether two listings of a file are the same version of it. */
const sameVersion = (a: AgentFileDto, b: AgentFileDto) =>
  a.kind === "text" && b.kind === "text"
    ? a.revision === b.revision
    : a.kind === b.kind && a.size === b.size && a.updatedAt === b.updatedAt;
const isMarkdown = (path: string) => languageForPath(path) === "markdown";

export function AgentEditor({ name }: Readonly<{ name: string }>) {
  const agent = useAgentQuery(name, { refetchOnMountOrArgChange: true });
  const types = useKushibotTypesQuery();
  const nodeTypes = useNodeTypesQuery();
  if (agent.error)
    return (
      <Alert
        className="kx:m-4"
        type="error"
        showIcon
        title={errorMessage(agent.error)}
        action={<Button onClick={() => void agent.refetch()}>Retry</Button>}
      />
    );
  // The types configure Monaco before the models exist, so wait for them (or their failure).
  if (!agent.data || types.isLoading || nodeTypes.isLoading)
    return (
      <div className="kx:flex kx:h-full kx:items-center kx:justify-center kx:bg-surface">
        <Spin aria-label="Loading agent" />
      </div>
    );
  return (
    // Each fetch replaces the drafts, e.g. after "Load latest".
    <AgentWorkspace
      key={agent.fulfilledTimeStamp}
      agent={agent.data}
      types={types.data}
      typesError={types.error}
      nodeTypes={nodeTypes.data}
      nodeTypesError={nodeTypes.error}
      onReload={() => void agent.refetch()}
    />
  );
}

function AgentWorkspace({
  agent,
  types,
  typesError,
  nodeTypes,
  nodeTypesError,
  onReload,
}: Readonly<{
  agent: AgentDto;
  types: LibraryTypesDto | undefined;
  typesError: unknown;
  nodeTypes: NodeTypesDto | undefined;
  nodeTypesError: unknown;
  onReload: () => void;
}>) {
  const [files, setFiles] = useState<readonly AgentFileDto[]>(agent.files);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      agent.files.flatMap((file) => (file.kind === "text" ? [[file.path, file.content]] : [])),
    ),
  );
  const [active, setActive] = useState(
    agent.files.some((file) => file.path === agent.primaryFile)
      ? agent.primaryFile
      : (agent.files[0]?.path ?? ""),
  );
  // Files open as tabs above the editor, in the order they were opened.
  const [tabs, setTabs] = useState<readonly string[]>(() => (active ? [active] : []));
  const narrow = useNarrow();
  /** Narrow screens show the explorer or the editor, not both. */
  const [narrowView, setNarrowView] = useState<"explorer" | "editor">("editor");
  const [update, result] = useUpdateAgentFileMutation();
  const { splitter, size } = usePersistedSplitter("agents:files", 2);
  const debugSplitter = usePersistedSplitter("agents:editor-debug", 2);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // The same editor and Monaco as state, for hooks that attach to them once they exist.
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  // Shown read-only over `active`: a kushibot declaration file opened by go-to-definition,
  // or a script outside the agent that the debugger stopped in.
  const [library, setLibrary] = useState<Library | null>(null);
  const revealRef = useRef<Reveal | null>(null);
  // Markdown files open rendered; these are the ones switched to the editor.
  const [editingMarkdown, setEditingMarkdown] = useState<ReadonlySet<string>>(() => new Set());
  const setMarkdownEditing = (path: string, editing: boolean) =>
    setEditingMarkdown((all) => {
      if (all.has(path) === editing) return all;
      const next = new Set(all);
      if (editing) next.add(path);
      else next.delete(path);
      return next;
    });

  const saved = (path: string) =>
    files.find((file): file is TextFile => file.path === path && file.kind === "text");
  const isDirty = (path: string) => {
    const file = saved(path);
    return !!file && drafts[path] !== file.content;
  };
  const dirty = new Set(Object.keys(drafts).filter(isDirty));
  const current = files.find((file) => file.path === active);
  const conflict = !!result.error && "status" in result.error && result.error.status === 409;

  const save = async (paths: readonly string[]) => {
    if (result.isLoading) return;
    for (const path of paths) {
      const file = saved(path);
      if (!file || !isDirty(path)) continue;
      try {
        const next = await update({
          name: agent.name,
          path,
          content: drafts[path]!,
          baseRevision: file.revision,
        }).unwrap();
        setFiles((all) => all.map((entry) => (entry.path === path ? next : entry)));
      } catch {
        // The mutation error is rendered above the editor; later files stay unsaved.
        return;
      }
    }
  };
  // Monaco keeps the first command callback, so it calls the current save through a ref.
  const saveActiveRef = useRef(() => save([active]));
  useEffect(() => {
    saveActiveRef.current = () => save([active]);
  });

  const openFile = (path: string) => {
    setLibrary(null);
    setActive(path);
    setTabs((open) => (open.includes(path) ? open : [...open, path]));
    setNarrowView("editor");
  };
  // Ctrl/Cmd+click and F12 land here when the definition is in another model.
  const openResourceRef = useRef<(uri: Uri) => boolean>(() => false);
  useEffect(() => {
    openResourceRef.current = (uri) => {
      const path = agentPathOf(agent.name, uri);
      if (path !== undefined && files.some((file) => file.path === path && file.kind === "text")) {
        openFile(path);
        return true;
      }
      const model = isLibraryUri(uri) ? monacoRef.current?.editor.getModel(uri) : null;
      if (model) {
        setLibrary({
          uri: uri.toString(),
          path: uri.path.replace(/^\/node_modules\//, ""),
          content: model.getValue(),
        });
        return true;
      }
      return false;
    };
  });
  // The editor wrapper restores view state and resets read-only values while switching models,
  // so the definition is revealed after it has settled (parent effects run after its own).
  const applyReveal = () => {
    const pending = revealRef.current;
    const instance = editorRef.current;
    if (!pending || instance?.getModel()?.uri.toString() !== pending.uri) return;
    revealRef.current = null;
    if ("startLineNumber" in pending.target) {
      instance.setSelection(pending.target);
      instance.revealRangeInCenterIfOutsideViewport(pending.target);
    } else {
      instance.setPosition(pending.target);
      instance.revealPositionInCenterIfOutsideViewport(pending.target);
    }
    instance.focus();
  };
  useEffect(applyReveal, [active, library]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setInstance(editor);
    setMonaco(monaco);
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => void saveActiveRef.current(),
    );
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (
        source: editor.ICodeEditor,
        resource: Uri,
        selectionOrPosition?: IRange | IPosition,
      ) => {
        if (source !== editor || !openResourceRef.current(resource)) return false;
        if (selectionOrPosition) {
          revealRef.current = { uri: resource.toString(), target: selectionOrPosition };
          applyReveal();
        }
        return true;
      },
    });
    // A debugged script is shown without the files it imports, so its type errors are noise.
    const markers = monaco.editor.onDidChangeMarkers((uris: readonly Uri[]) => {
      for (const uri of uris) {
        const model = uri.toString().startsWith(SCRIPT_URI_PREFIX) && monaco.editor.getModel(uri);
        if (!model) continue;
        const owners = new Set(
          monaco.editor
            .getModelMarkers({ resource: uri })
            .map((marker: editor.IMarker) => marker.owner),
        );
        for (const owner of owners) monaco.editor.setModelMarkers(model, owner, []);
      }
    });
    editor.onDidDispose(() => {
      opener.dispose();
      markers.dispose();
      if (editorRef.current === editor) editorRef.current = null;
      setInstance((current) => (current === editor ? null : current));
    });
  };

  const anyDirty = dirty.size > 0;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  // The models outlive file switches; they belong to this workspace until it closes.
  useEffect(
    () => () => {
      if (monacoRef.current) disposeAgentModels(monacoRef.current, agent.name);
    },
    [agent.name],
  );

  const addFile = (file: AgentFileDto) => {
    setFiles((all) => [...all, file].sort((a, b) => a.path.localeCompare(b.path)));
    if (file.kind === "text") {
      setDrafts((all) => ({ ...all, [file.path]: file.content }));
      if (monacoRef.current)
        syncAgentModels(monacoRef.current, agent.name, { [file.path]: file.content });
    }
    openFile(file.path);
  };

  // Files changed on disk by something else, such as an agent run or another editor, show
  // up as they are now. Files with unsaved edits stay as they were opened, so saving them
  // reports the conflict instead of overwriting the other change.
  const activeUri = agentFileUri(agent.name, active);
  const listing = useAgentFilesQuery(agent.name).data;
  const onDisk = listing?.files;
  const [merged, setMerged] = useState(onDisk);
  if (onDisk && onDisk !== merged) {
    setMerged(onDisk);
    const known = new Map(files.map((file) => [file.path, file]));
    const next = onDisk.map((file) => {
      const mine = known.get(file.path);
      return mine && (isDirty(file.path) || sameVersion(mine, file)) ? mine : file;
    });
    const paths = new Set(next.map((file) => file.path));
    const removed = files.filter((file) => !paths.has(file.path) && !isDirty(file.path));
    const kept = files.filter((file) => !paths.has(file.path) && isDirty(file.path));
    const changed = next.filter((file) => file !== known.get(file.path));
    if (changed.length > 0 || removed.length > 0) {
      const all = [...next, ...kept].sort((a, b) => a.path.localeCompare(b.path));
      setFiles(all);
      setDrafts((drafts) => {
        const updated = { ...drafts };
        for (const file of changed) if (file.kind === "text") updated[file.path] = file.content;
        for (const file of removed) delete updated[file.path];
        return updated;
      });
      if (!all.some((file) => file.path === active)) {
        setLibrary(null);
        setActive(
          all.some((file) => file.path === agent.primaryFile)
            ? agent.primaryFile
            : (all[0]?.path ?? ""),
        );
      }
    }
  }
  // Monaco type-checks every model, so they follow the files: drafts of new or reloaded
  // files fill their models, and models of files gone from the folder are dropped.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    syncAgentModels(monaco, agent.name, drafts);
    const paths = new Set(files.map((file) => agentFileUri(agent.name, file.path)));
    const prefix = agentFileUri(agent.name, "");
    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString(true);
      if (uri.startsWith(prefix) && !paths.has(uri) && uri !== activeUri) model.dispose();
    }
    // Drafts change on every keystroke, and the editor keeps the active model in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Debugging: the latest debug run of this agent, its pause and the breakpoints.
  const dispatch = useAppDispatch();
  const debugRun = useAppSelector(selectDebugRun);
  const run = debugRun?.agentName === agent.name ? debugRun : undefined;
  const selectedFrame = useAppSelector(selectSelectedFrame);
  const breakpoints = useAppSelector((state) => selectAgentBreakpoints(state, agent.name));
  const [fetchScript] = useLazyScriptSourceQuery();
  const [debugError, setDebugError] = useState<string | null>(null);
  const frame = run?.paused?.frames[selectedFrame];
  const [sideTab, setSideTab] = useState<SideTab>(run ? "debug" : "files");

  const reveal = (uri: string, lineNumber: number, column = 1) => {
    revealRef.current = {
      uri: monaco ? monaco.Uri.parse(uri).toString() : uri,
      target: { lineNumber, column },
    };
    applyReveal();
  };
  const isTextFile = (path: string) =>
    files.some((file) => file.path === path && file.kind === "text");
  const openLocation = (path: string, line: number, column = 1) => {
    if (!isTextFile(path)) return;
    openFile(path);
    // A line is only visible in the editor, not in the rendered markdown.
    if (isMarkdown(path)) setMarkdownEditing(path, true);
    reveal(agentFileUri(agent.name, path), line, column);
  };
  /** Loads a script outside the agent, such as kushibot's TypeScript, to show read-only. */
  const loadScript = async (runId: string, target: DebugCallFrameDto) => {
    const { scriptId } = target.location;
    const script = await fetchScript({ runId, scriptId }, true).unwrap();
    const name = script.url.split("/").at(-1) || `script-${scriptId}.js`;
    return {
      uri: `${SCRIPT_URI_PREFIX}${runId}/${scriptId}/${name}`,
      path: script.url,
      content: script.source,
      language: languageForPath(name) === "typescript" ? "typescript" : "javascript",
      scriptId,
    } satisfies Library;
  };
  const showScript = (script: Library, target: DebugCallFrameDto) => {
    setDebugError(null);
    setLibrary(script);
    reveal(script.uri, target.location.line, target.location.column);
  };
  const openScript = (target: DebugCallFrameDto) => {
    if (!run) return;
    loadScript(run.id, target).then(
      (script) => showScript(script, target),
      (failure: unknown) => setDebugError(errorMessage(failure)),
    );
  };
  const openFrame = (target: DebugCallFrameDto) =>
    target.location.file
      ? openLocation(target.location.file, target.location.line, target.location.column)
      : openScript(target);

  // Follow the debugger to where the run paused, or to the frame picked in the call stack.
  // Agent files switch during render; the paused line is revealed by its decoration.
  const followKey = frame ? `${run?.paused?.seq}:${selectedFrame}` : null;
  // Starts unfollowed, so opening the editor during a pause (e.g. from the chat) shows it.
  const [followed, setFollowed] = useState<string | null>(null);
  if (followKey !== followed) {
    setFollowed(followKey);
    if (followKey) setSideTab("debug");
    const file = frame?.location.file;
    if (file && isTextFile(file)) {
      setLibrary(null);
      setActive(file);
      setTabs((open) => (open.includes(file) ? open : [...open, file]));
    }
  }
  const externalFrame = frame && !frame.location.file ? frame : undefined;
  useEffect(() => {
    if (!externalFrame || !run) return;
    let current = true;
    loadScript(run.id, externalFrame).then(
      (script) => current && showScript(script, externalFrame),
      (failure: unknown) => current && setDebugError(errorMessage(failure)),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  const lines = library ? null : (breakpoints[active] ?? NO_LINES);
  const unverified = useMemo(
    () =>
      new Set(
        (run?.breakpoints ?? [])
          .filter((state) => state.file === active && !state.verified)
          .map((state) => state.requestedLine),
      ),
    [run?.breakpoints, active],
  );
  const shown = library
    ? frame && !frame.location.file && frame.location.scriptId === library.scriptId
    : frame?.location.file === active;
  useDebugDecorations(instance, monaco, {
    lines,
    unverified,
    current: frame && shown ? { line: frame.location.line, top: selectedFrame === 0 } : null,
    onToggle: (line) => dispatch(breakpointToggled({ agentName: agent.name, file: active, line })),
    onMoved: (moved) =>
      dispatch(breakpointsMoved({ agentName: agent.name, file: active, lines: moved })),
  });

  // Code notes: markdown notes pinned to lines of the agent's files, or general ones not tied to
  // any code, kept in the database as one markdown document. They anchor against the drafts, so
  // their marks follow the code while it is edited.
  const storedNotes = useAgentNotesQuery(agent.name, { refetchOnMountOrArgChange: true });
  const notesText = storedNotes.data?.content ?? "";
  const notes = useMemo(() => parseNotes(notesText), [notesText]);
  const pinned = notes.map((note) => ({
    note,
    anchor: anchorNote(
      note,
      note.file !== null && isTextFile(note.file) ? drafts[note.file] : undefined,
    ),
  }));
  const [noteDraft, setNoteDraft] = useState<NoteView | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [updateNotes] = useUpdateAgentNotesMutation();
  const selectedPinned = pinned.find(({ note }) => note.id === selectedNoteId);
  const notePanelWidth = useResizableWidth("kushex:agents:note-width", 360);

  /** Saves all of the agent's notes. */
  const writeNotes = async (next: readonly CodeNote[]) => {
    if (!storedNotes.data) {
      setNoteError("The notes are not loaded yet.");
      return false;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      await updateNotes({
        name: agent.name,
        content: serializeNotes(next),
        baseRevision: storedNotes.data.revision,
      }).unwrap();
      return true;
    } catch (failure) {
      setNoteError(errorMessage(failure));
      return false;
    } finally {
      setNoteSaving(false);
    }
  };
  /** The notes with lines that moved saved where their code is now. */
  const withMovedLines = () =>
    pinned.map(({ note, anchor }) =>
      anchor.status === "moved" ? { ...note, start: anchor.start, end: anchor.end } : note,
    );
  const snippetOf = (file: string, { start, end }: LineRange) =>
    (drafts[file] ?? "")
      .split("\n")
      .slice(start - 1, end)
      .join("\n");

  const openNote = (id: string) => {
    const found = pinned.find(({ note }) => note.id === id);
    if (!found) return;
    setNoteDraft(null);
    setNoteError(null);
    setSelectedNoteId(id);
    // A general note has no file to open.
    if (found.note.file === null) setNarrowView("editor");
    else if (isTextFile(found.note.file)) openLocation(found.note.file, found.anchor.start);
  };
  const addNote = (lines: LineRange) => {
    if (library || current?.kind !== "text") return;
    setSelectedNoteId(null);
    setNoteError(null);
    setNoteDraft({ id: null, file: active, ...lines, snippet: snippetOf(active, lines), body: "" });
  };
  const addGeneralNote = () => {
    setSelectedNoteId(null);
    setNoteError(null);
    setNoteDraft({ id: null, file: null, start: 0, end: 0, snippet: "", body: "" });
    setNarrowView("editor");
  };
  const saveNote = async (body: string) => {
    if (noteDraft) {
      const note: CodeNote = {
        id: newNoteId(),
        file: noteDraft.file,
        start: noteDraft.start,
        end: noteDraft.end,
        snippet: noteDraft.snippet,
        body,
        created: new Date().toISOString(),
      };
      if (await writeNotes([...withMovedLines(), note])) {
        setNoteDraft(null);
        setSelectedNoteId(note.id);
      }
    } else if (selectedNoteId) {
      await writeNotes(
        withMovedLines().map((note) => (note.id === selectedNoteId ? { ...note, body } : note)),
      );
    }
  };
  const deleteNote = async () => {
    if (await writeNotes(withMovedLines().filter((note) => note.id !== selectedNoteId)))
      setSelectedNoteId(null);
  };
  /** Deletes the notes whose file is gone. */
  const deleteOrphanedNotes = async () => {
    const orphaned = new Set(
      pinned.filter(({ anchor }) => anchor.status === "missing").map(({ note }) => note.id),
    );
    if (
      (await writeNotes(withMovedLines().filter((note) => !orphaned.has(note.id)))) &&
      selectedNoteId &&
      orphaned.has(selectedNoteId)
    )
      setSelectedNoteId(null);
  };
  const reattachNote = async () => {
    const lines = editorRef.current && selectedLines(editorRef.current);
    const selection = editorRef.current?.getSelection();
    if (!lines || !selection || selection.isEmpty()) {
      setNoteError("Select the code to attach the note to, then re-attach.");
      return;
    }
    await writeNotes(
      withMovedLines().map((note) =>
        note.id === selectedNoteId
          ? { ...note, file: active, ...lines, snippet: snippetOf(active, lines) }
          : note,
      ),
    );
  };
  const closeNote = () => {
    setNoteDraft(null);
    setSelectedNoteId(null);
    setNoteError(null);
  };
  useCodeNotes(instance, monaco, {
    notes: library ? [] : pinned.filter(({ note }) => note.file === active),
    selectedId: selectedNoteId,
    // No new notes while one is being written, so the button does not cover the draft's code.
    enabled: !library && current?.kind === "text" && !noteDraft,
    onOpen: openNote,
    onAdd: addNote,
  });
  const panelNote: NoteView | null = noteDraft ?? selectedPinned?.note ?? null;
  const notePanel = panelNote && (
    <NotePanel
      key={panelNote.id ?? `new:${panelNote.file}:${panelNote.start}`}
      note={panelNote}
      anchor={noteDraft ? null : (selectedPinned?.anchor ?? null)}
      saving={noteSaving}
      error={noteError}
      onSave={(body) => void saveNote(body)}
      onDelete={() => void deleteNote()}
      onClose={closeNote}
      onReveal={() => {
        const start = selectedPinned?.anchor.start ?? panelNote.start;
        if (panelNote.file !== null && isTextFile(panelNote.file))
          openLocation(panelNote.file, start);
      }}
      onReattach={library || noteDraft ? undefined : () => void reattachNote()}
    />
  );

  const breakpointCount = Object.values(breakpoints).reduce(
    (total, lines) => total + lines.length,
    0,
  );
  const openTabs = [
    ...tabs.filter((path) => files.some((file) => file.path === path)),
    ...(current && !tabs.includes(active) ? [active] : []),
  ];
  const closeTabs = (close: (tab: string, index: number) => boolean) => {
    const rest = openTabs.filter((tab, index) => !close(tab, index));
    setTabs(rest);
    if (!library && !rest.includes(active)) {
      const at = openTabs.indexOf(active);
      // Prefer the nearest surviving tab to the right, then the nearest to the left.
      const next =
        openTabs.slice(at + 1).find((tab) => rest.includes(tab)) ??
        openTabs.slice(0, at).findLast((tab) => rest.includes(tab));
      setActive(next ?? "");
    }
  };
  const closeTab = (path: string) => closeTabs((tab) => tab === path);
  const tabMenu = (path: string): MenuProps => {
    const at = openTabs.indexOf(path);
    return {
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === "close") closeTab(path);
        else if (key === "others") closeTabs((tab) => tab !== path);
        else if (key === "right") closeTabs((_, index) => index > at);
        else if (key === "left") closeTabs((_, index) => index < at);
        else if (key === "saved") closeTabs((tab) => !dirty.has(tab));
        else if (key === "all") closeTabs(() => true);
        else if (key === "copy") void navigator.clipboard.writeText(path);
      },
      items: [
        { key: "close", label: "Close" },
        { key: "others", label: "Close Others", disabled: openTabs.length < 2 },
        { key: "left", label: "Close to the Left", disabled: at === 0 },
        { key: "right", label: "Close to the Right", disabled: at === openTabs.length - 1 },
        { key: "saved", label: "Close Saved", disabled: openTabs.every((tab) => dirty.has(tab)) },
        { key: "all", label: "Close All" },
        { type: "divider" },
        { key: "copy", label: "Copy Path" },
      ],
    };
  };
  const pathParts = (library ? library.path : active).split("/").filter(Boolean);
  const markdownFile = !library && current?.kind === "text" && isMarkdown(active);
  const previewing = markdownFile && !editingMarkdown.has(active);

  const tabStrip = openTabs.length > 0 && (
    <div
      role="tablist"
      aria-label="Open files"
      className={`kx:flex kx:h-9 kx:shrink-0 kx:overflow-x-auto kx:bg-surface-muted ${borderB}`}
    >
      {openTabs.map((path) => {
        const selected = !library && path === active;
        const unsaved = dirty.has(path);
        return (
          <Dropdown key={path} trigger={["contextMenu"]} menu={tabMenu(path)}>
            <div
              title={path}
              className={`kx:group kx:relative kx:flex kx:max-w-56 kx:shrink-0 kx:items-center kx:gap-1 kx:pr-1 kx:pl-3 kx:text-[13px] ${borderR} ${
                selected
                  ? "kx:bg-surface kx:text-text kx:before:absolute kx:before:inset-x-0 kx:before:top-0 kx:before:h-0.5 kx:before:bg-primary"
                  : "kx:text-text-muted kx:hover:bg-fill"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => openFile(path)}
                onAuxClick={(event) => event.button === 1 && closeTab(path)}
                className="kx:flex kx:min-w-0 kx:cursor-pointer kx:items-center kx:gap-1.5 kx:self-stretch kx:border-0 kx:bg-transparent kx:p-0 kx:text-inherit"
              >
                <FileTypeIcon path={path} size={15} />
                <span className="kx:truncate">{path.split("/").at(-1)}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${path}`}
                onClick={() => closeTab(path)}
                className="kx:inline-flex kx:size-5 kx:shrink-0 kx:cursor-pointer kx:items-center kx:justify-center kx:border-0 kx:bg-transparent kx:p-0 kx:text-text-muted kx:hover:bg-fill kx:hover:text-text"
              >
                {unsaved ? (
                  <>
                    <span
                      aria-hidden
                      className="kx:size-2 kx:rounded-full kx:bg-primary kx:group-hover:hidden"
                    />
                    <IconX size={14} className="kx:hidden kx:group-hover:block" />
                  </>
                ) : (
                  <IconX
                    size={14}
                    className={selected ? "" : "kx:opacity-0 kx:group-hover:opacity-100"}
                  />
                )}
              </button>
            </div>
          </Dropdown>
        );
      })}
    </div>
  );

  const editorPane = (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      {tabStrip}
      <div className={`kx:flex kx:h-9 kx:shrink-0 kx:items-center kx:gap-2 kx:px-3 ${borderB}`}>
        {narrow && (
          <Button
            type="text"
            size="small"
            onClick={() => setNarrowView("explorer")}
            icon={<AppIcon icon={IconArrowLeft} label="Show files" />}
          />
        )}
        <nav
          aria-label="File path"
          className="kx:flex kx:min-w-0 kx:flex-1 kx:items-center kx:gap-1 kx:overflow-hidden kx:text-xs kx:text-text-muted"
        >
          <span className="kx:shrink-0">{library ? "library" : agent.name}</span>
          {pathParts.map((part, index) => {
            const last = index === pathParts.length - 1;
            return (
              <span
                key={index}
                className={`kx:flex kx:items-center kx:gap-1 ${last ? "kx:min-w-0" : "kx:shrink-0"}`}
              >
                <IconChevronRight size={12} className="kx:shrink-0 kx:opacity-60" />
                {last && <FileTypeIcon path={part} size={14} />}
                <span className={last ? "kx:truncate kx:font-medium kx:text-text" : ""}>
                  {part}
                </span>
              </span>
            );
          })}
          {library && (
            <Tag
              className="kx:ml-1 kx:shrink-0"
              icon={<IconLock size={11} className="kx:mr-1 kx:align-[-1px]" />}
            >
              read-only
            </Tag>
          )}
          {!library && active === agent.primaryFile && (
            <Tooltip title="The file the agent starts from">
              <Tag color="orange" className="kx:ml-1 kx:shrink-0">
                entry point
              </Tag>
            </Tooltip>
          )}
        </nav>
        {library ? (
          <Button size="small" onClick={() => setLibrary(null)}>
            Back to {active.split("/").at(-1)}
          </Button>
        ) : (
          <div className="kx:flex kx:shrink-0 kx:items-center kx:gap-2">
            {markdownFile && (
              <Segmented<"preview" | "edit">
                size="small"
                aria-label="Markdown view"
                value={previewing ? "preview" : "edit"}
                onChange={(view) => setMarkdownEditing(active, view === "edit")}
                options={[
                  { value: "preview", label: "Preview", icon: <IconEye size={14} /> },
                  { value: "edit", label: "Edit", icon: <IconCode size={14} /> },
                ]}
              />
            )}
            {dirty.size > 0 && (
              <Typography.Text type="secondary" className="kx:hidden kx:text-xs kx:sm:inline">
                {dirty.size} unsaved
              </Typography.Text>
            )}
            {[...dirty].some((path) => path !== active) && (
              <Button size="small" onClick={() => void save([...dirty])}>
                Save all
              </Button>
            )}
            <Tooltip title={`Save (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}S)`}>
              <Button
                type="primary"
                size="small"
                disabled={!dirty.has(active)}
                loading={result.isLoading}
                onClick={() => void save([active])}
                icon={<IconDeviceFloppy size={14} />}
              >
                Save
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      {debugError && (
        <Alert
          banner
          closable
          type="error"
          title={debugError}
          onClose={() => setDebugError(null)}
        />
      )}
      {result.error && (
        <Alert
          banner
          type="error"
          title={`${result.originalArgs?.path}: ${errorMessage(result.error)}`}
          action={
            conflict && (
              <Button size="small" danger onClick={onReload}>
                Discard my changes and load latest
              </Button>
            )
          }
        />
      )}
      {typesError ? (
        <Alert
          banner
          type="warning"
          title={`kushibot types are unavailable, so imports are not type-checked: ${errorMessage(typesError)}`}
        />
      ) : (
        types?.files.length === 0 && (
          <Alert
            banner
            type="info"
            title="Set KUSHEX_KUSHIBOT_DIR on the server to type-check against kushibot."
          />
        )
      )}
      {nodeTypesError ? (
        <Alert
          banner
          type="warning"
          title={`Node.js types are unavailable, so its modules are not type-checked: ${errorMessage(nodeTypesError)}`}
        />
      ) : null}
      {library || current?.kind === "text" ? (
        // The preview covers the editor rather than replacing it, so Monaco is not remounted.
        <div className="kx:relative kx:flex kx:min-h-0 kx:flex-1 kx:flex-col">
          <CodeEditor
            value={library ? library.content : (drafts[active] ?? "")}
            path={library ? library.uri : activeUri}
            language={library ? (library.language ?? "typescript") : undefined}
            readOnly={!!library}
            keepCurrentModel
            // Like VS Code's Ctrl/Cmd+click: jump to the first definition, e.g. a class
            // rather than a peek listing it and its constructor.
            options={{ gotoLocation: { multipleDefinitions: "goto" }, glyphMargin: true }}
            ariaLabel={library ? `${library.path} (read-only)` : `${active} in ${agent.name}`}
            onChange={(value) => {
              // The wrapper may call a stale callback while it swaps models, so only edits
              // to the active file's own model become its draft.
              const model = editorRef.current?.getModel();
              if (model?.uri.toString() !== monacoRef.current?.Uri.parse(activeUri).toString())
                return;
              setDrafts((all) => ({ ...all, [active]: value }));
            }}
            beforeMount={(monaco) => {
              monacoRef.current = monaco;
              configureAgentLanguage(monaco, types, nodeTypes);
              syncAgentModels(monaco, agent.name, drafts);
            }}
            onMount={handleMount}
          />
          {previewing && (
            <div
              role="document"
              aria-label={`${active} preview`}
              title="Double-click to edit"
              onDoubleClick={() => setMarkdownEditing(active, true)}
              className="kx:absolute kx:inset-0 kx:z-10 kx:overflow-auto kx:bg-surface kx:px-6 kx:py-4"
            >
              {drafts[active]?.trim() ? (
                <Markdown text={drafts[active]} className="kx:mx-auto kx:max-w-3xl" />
              ) : (
                <Typography.Text type="secondary">This file is empty.</Typography.Text>
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyMain
          text={
            current?.kind === "binary"
              ? "Binary file; it cannot be edited here."
              : current
                ? "This file is too large to edit here."
                : files.length > 0
                  ? "Open a file from the explorer."
                  : "This agent folder has no files."
          }
        />
      )}
    </div>
  );

  const sideTabs: readonly { key: SideTab; label: string; extra?: ReactNode }[] = [
    { key: "files", label: "Files" },
    {
      key: "notes",
      label: "Notes",
      extra:
        notes.length > 0 ? (
          <span className="kx:bg-fill kx:px-1 kx:text-[10px] kx:leading-4 kx:text-text-muted">
            {notes.length}
          </span>
        ) : undefined,
    },
    {
      key: "debug",
      label: "Debug",
      extra:
        run && !isFinished(run.status) ? (
          <span
            aria-hidden
            title={run.paused ? "Paused" : "Running"}
            className={`kx:size-1.5 kx:rounded-full ${run.paused ? "kx:bg-warning" : "kx:bg-success"}`}
          />
        ) : breakpointCount > 0 ? (
          <span className="kx:bg-fill kx:px-1 kx:text-[10px] kx:leading-4 kx:text-text-muted">
            {breakpointCount}
          </span>
        ) : undefined,
    },
  ];

  const sidePanel = (
    <div className={`kx:flex kx:h-full kx:flex-col kx:bg-surface ${narrow ? "" : borderR}`}>
      <div className={`kx:shrink-0 ${borderB}`}>
        <AgentSwitcher name={agent.name} />
      </div>
      <div
        role="tablist"
        aria-label="Explorer"
        className={`kx:flex kx:shrink-0 kx:gap-1 kx:px-2 ${borderB}`}
      >
        {sideTabs.map((tab) => {
          const selected = sideTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`agent-side-${tab.key}`}
              aria-selected={selected}
              aria-controls={`agent-side-${tab.key}-panel`}
              onClick={() => setSideTab(tab.key)}
              className={`kx:relative kx:flex kx:h-9 kx:cursor-pointer kx:items-center kx:gap-1.5 kx:border-0 kx:bg-transparent kx:px-2 kx:text-[13px] kx:font-medium ${
                selected
                  ? "kx:text-text kx:after:absolute kx:after:inset-x-2 kx:after:bottom-0 kx:after:h-0.5 kx:after:bg-primary"
                  : "kx:text-text-muted kx:hover:text-text"
              }`}
            >
              {tab.label}
              {tab.extra}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="agent-side-files-panel"
        aria-labelledby="agent-side-files"
        hidden={sideTab !== "files"}
        className="kx:min-h-0 kx:flex-1"
      >
        <AgentFiles
          agentName={agent.name}
          files={files}
          folders={listing?.folders ?? agent.folders}
          primaryFile={agent.primaryFile}
          active={library ? "" : active}
          dirty={dirty}
          withBreakpoints={new Set(Object.keys(breakpoints))}
          withNotes={new Set(notes.flatMap((note) => note.file ?? []))}
          onOpen={openFile}
          onCreated={addFile}
        />
      </div>
      <div
        role="tabpanel"
        id="agent-side-notes-panel"
        aria-labelledby="agent-side-notes"
        hidden={sideTab !== "notes"}
        className="kx:min-h-0 kx:flex-1"
      >
        <NotesList
          notes={pinned}
          activeFile={active}
          selectedId={selectedNoteId}
          adding={noteDraft !== null}
          onOpen={openNote}
          onAdd={addGeneralNote}
          onDeleteOrphaned={deleteOrphanedNotes}
        />
      </div>
      {/* Mounted while hidden too, so the debugging keys work from the Files tab. */}
      <div
        role="tabpanel"
        id="agent-side-debug-panel"
        aria-labelledby="agent-side-debug"
        hidden={sideTab !== "debug"}
        className="kx:min-h-0 kx:flex-1"
      >
        <DebugPanel run={run} onOpenFrame={openFrame}>
          <BreakpointsSection
            agentName={agent.name}
            contentOf={(file) => drafts[file]}
            bound={run && !isFinished(run.status) ? run.breakpoints : NO_BOUND}
            onOpen={openLocation}
          />
        </DebugPanel>
      </div>
    </div>
  );

  // The note opens beside the code (over it on narrow screens). The editor stays at the same
  // place in the tree whether or not a note is open, so Monaco is not remounted.
  const editorWithNote = (
    <div className="kx:relative kx:flex kx:h-full kx:min-w-0">
      <div className="kx:h-full kx:min-w-0 kx:flex-1">{editorPane}</div>
      {notePanel &&
        (narrow ? (
          <div className="kx:absolute kx:inset-0 kx:z-10">{notePanel}</div>
        ) : (
          <>
            <button
              type="button"
              aria-label="Resize note (arrow keys)"
              {...notePanelWidth.handleProps}
              className={`kx:w-1 kx:shrink-0 kx:cursor-col-resize kx:border-y-0 kx:border-r-0 kx:bg-transparent kx:p-0 kx:hover:bg-primary/40 kx:focus-visible:bg-primary/40 kx:focus-visible:outline-none ${borderL}`}
            />
            <div className="kx:h-full kx:shrink-0" style={{ width: notePanelWidth.width }}>
              {notePanel}
            </div>
          </>
        ))}
    </div>
  );

  const editorArea = run ? (
    <Splitter orientation="vertical" {...debugSplitter.splitter}>
      <Splitter.Panel size={debugSplitter.size(0)} min={160}>
        {editorWithNote}
      </Splitter.Panel>
      <Splitter.Panel size={debugSplitter.size(1)} defaultSize="25%" min={80}>
        <DebugConsole key={run.id} run={run} frame={frame} />
      </Splitter.Panel>
    </Splitter>
  ) : (
    editorWithNote
  );

  if (narrow) return narrowView === "explorer" ? sidePanel : editorArea;
  return (
    <Splitter {...splitter}>
      <Splitter.Panel size={size(0)} defaultSize={280} min={200} max="50%" collapsible>
        {sidePanel}
      </Splitter.Panel>
      <Splitter.Panel size={size(1)} min={320}>
        {editorArea}
      </Splitter.Panel>
    </Splitter>
  );
}
