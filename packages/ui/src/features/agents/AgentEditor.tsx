import type { OnMount } from "@monaco-editor/react";
import { Alert, Button, Space, Spin, Splitter, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AgentDto, AgentFileDto, LibraryTypesDto } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useAgentQuery,
  useKushibotTypesQuery,
  useUpdateAgentFileMutation,
} from "../../shared/api/kushexApi";
import { CodeEditor } from "../../shared/components/CodeEditor";
import { borderB } from "../../shared/lib/styles";
import { usePersistedSplitter } from "../settings/usePersistedSplitter";
import { EmptyMain } from "../workbench/EmptyMain";
import { AgentFiles } from "./AgentFiles";
import {
  agentFileUri,
  configureAgentLanguage,
  disposeAgentModels,
  syncAgentModels,
  type Monaco,
} from "./agentLanguage";

type TextFile = Extract<AgentFileDto, { kind: "text" }>;

export function AgentEditor({ name }: Readonly<{ name: string }>) {
  const agent = useAgentQuery(name, { refetchOnMountOrArgChange: true });
  const types = useKushibotTypesQuery();
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
  if (!agent.data || types.isLoading)
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
      onReload={() => void agent.refetch()}
    />
  );
}

function AgentWorkspace({
  agent,
  types,
  typesError,
  onReload,
}: Readonly<{
  agent: AgentDto;
  types: LibraryTypesDto | undefined;
  typesError: unknown;
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
  const [update, result] = useUpdateAgentFileMutation();
  const { splitter, size } = usePersistedSplitter("agents:files", 2);
  const monacoRef = useRef<Monaco | null>(null);

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
  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => void saveActiveRef.current(),
    );
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
    setActive(file.path);
  };

  return (
    <Splitter {...splitter}>
      <Splitter.Panel size={size(0)} defaultSize={220} min={140} max="50%" collapsible>
        <AgentFiles
          agentName={agent.name}
          files={files}
          primaryFile={agent.primaryFile}
          active={active}
          dirty={dirty}
          onOpen={setActive}
          onCreated={addFile}
        />
      </Splitter.Panel>
      <Splitter.Panel size={size(1)} min={320}>
        <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
          <div
            className={`kx:flex kx:h-10 kx:shrink-0 kx:items-center kx:gap-2 kx:px-3 ${borderB}`}
          >
            <Typography.Text strong>{agent.name}</Typography.Text>
            <Typography.Text type="secondary" className="kx:truncate kx:text-xs">
              agents/{agent.name}/{active}
            </Typography.Text>
            {active === agent.primaryFile && <Tag>primary</Tag>}
            {dirty.has(active) && <Tag color="warning">Unsaved</Tag>}
            <Space className="kx:ml-auto" size="small">
              <Button
                size="small"
                disabled={dirty.size === 0}
                onClick={() => void save([...dirty])}
              >
                Save all
              </Button>
              <Button
                type="primary"
                size="small"
                disabled={!dirty.has(active)}
                loading={result.isLoading}
                onClick={() => void save([active])}
              >
                Save
              </Button>
            </Space>
          </div>
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
          {current?.kind === "text" ? (
            <CodeEditor
              value={drafts[active] ?? ""}
              path={agentFileUri(agent.name, active)}
              readOnly={false}
              keepCurrentModel
              ariaLabel={`${active} in ${agent.name}`}
              onChange={(value) => setDrafts((all) => ({ ...all, [active]: value }))}
              beforeMount={(monaco) => {
                monacoRef.current = monaco;
                configureAgentLanguage(monaco, types);
                syncAgentModels(monaco, agent.name, drafts);
              }}
              onMount={handleMount}
            />
          ) : (
            <EmptyMain
              text={
                current?.kind === "binary"
                  ? "Binary file; it cannot be edited here."
                  : current
                    ? "This file is too large to edit here."
                    : "This agent folder has no files."
              }
            />
          )}
        </div>
      </Splitter.Panel>
    </Splitter>
  );
}
