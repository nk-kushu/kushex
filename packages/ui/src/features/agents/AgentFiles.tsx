import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Tooltip,
  Typography,
  type InputRef,
} from "antd";
import { IconFilePlus, IconFold, IconSearch } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import type { AgentFileDto } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import { useCreateAgentFileMutation } from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { borderAll, borderT } from "../../shared/lib/styles";
import { FileTree, foldersOf } from "./FileTree";
import { FileTypeIcon } from "./fileIcons";

/** Same rule as the server: no `..`, no hidden files, at most 8 segments. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const isValidPath = (path: string) =>
  path.length <= 512 &&
  path.split("/").length <= 8 &&
  path.split("/").every((segment) => SEGMENT.test(segment));
/** Small folders open fully; large ones open only down to the file being edited. */
const EXPAND_ALL_UP_TO = 40;

type Props = Readonly<{
  agentName: string;
  files: readonly AgentFileDto[];
  /** Folders on disk, which also shows the empty ones. */
  folders: readonly string[];
  primaryFile: string;
  active: string;
  dirty: ReadonlySet<string>;
  /** Files that have breakpoints; they get a red dot like in VS Code's explorer. */
  withBreakpoints?: ReadonlySet<string>;
  withNotes?: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onCreated: (file: AgentFileDto) => void;
}>;

/** The agent folder: a filter, the file tree and creating files. */
export function AgentFiles({
  agentName,
  files,
  folders: onDisk,
  primaryFile,
  active,
  dirty,
  withBreakpoints,
  withNotes,
  onOpen,
  onCreated,
}: Props) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const folders = useMemo(
    () => [...new Set([...foldersOf(paths), ...onDisk])].sort(),
    [paths, onDisk],
  );
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filter = query.trim().toLowerCase();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
    paths.length <= EXPAND_ALL_UP_TO ? new Set(folders) : foldersOf([active]),
  );
  // Opening a file, including a newly created one, reveals its folders.
  const [revealed, setRevealed] = useState(active);
  if (revealed !== active) {
    setRevealed(active);
    setExpanded((open) => new Set([...open, ...foldersOf([active])]));
  }

  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <div className="kx:flex kx:shrink-0 kx:items-center kx:gap-1 kx:px-2 kx:py-2">
        <Input
          size="small"
          allowClear
          aria-label="Filter files"
          placeholder="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          prefix={
            <span className="kx:inline-flex kx:text-text-muted">
              <IconSearch size={14} stroke={1.75} />
            </span>
          }
        />
        <Tooltip title="New file">
          <Button
            type="text"
            size="small"
            onClick={() => setCreatingIn("")}
            icon={<AppIcon icon={IconFilePlus} label="New file" />}
          />
        </Tooltip>
        <Tooltip title="Collapse folders">
          <Button
            type="text"
            size="small"
            disabled={expanded.size === 0 || !!filter}
            onClick={() => setExpanded(new Set())}
            icon={<AppIcon icon={IconFold} label="Collapse folders" />}
          />
        </Tooltip>
      </div>
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto">
        <FileTree
          label="Agent files"
          paths={paths}
          folders={folders}
          active={active}
          expanded={expanded}
          onExpandedChange={(folder, open) =>
            setExpanded((all) => {
              const next = new Set(all);
              if (open) next.add(folder);
              else
                for (const path of all)
                  if (path === folder || path.startsWith(`${folder}/`)) next.delete(path);
              return next;
            })
          }
          onOpen={onOpen}
          onNewFileIn={setCreatingIn}
          filter={filter}
          primaryFile={primaryFile}
          dirty={dirty}
          withBreakpoints={withBreakpoints}
          withNotes={withNotes}
          empty={
            <Typography.Text type="secondary" className="kx:block kx:text-center kx:text-xs">
              {filter ? (
                <>No files match “{query.trim()}”.</>
              ) : (
                <>
                  This agent has no files yet.{" "}
                  <Typography.Link onClick={() => setCreatingIn("")}>Create one</Typography.Link>
                </>
              )}
            </Typography.Text>
          }
        />
      </div>
      <div
        className={`kx:flex kx:h-7 kx:shrink-0 kx:items-center kx:gap-1.5 kx:px-3 kx:text-[11px] kx:text-text-muted ${borderT}`}
      >
        <span>
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        {dirty.size > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="kx:text-primary">{dirty.size} unsaved</span>
          </>
        )}
      </div>
      {creatingIn !== null && (
        <CreateFileDialog
          agentName={agentName}
          folders={folders}
          existing={paths}
          initialFolder={creatingIn}
          onClose={() => setCreatingIn(null)}
          onCreated={(file) => {
            setCreatingIn(null);
            setQuery("");
            onCreated(file);
          }}
        />
      )}
    </div>
  );
}

type CreateFileForm = { folder: string; name: string };
const EXTENSIONS = [".ts", ".md", ".json"] as const;
const joinPath = (folder: string | undefined, name: string | undefined) =>
  [folder, name?.trim()].filter(Boolean).join("/");

function CreateFileDialog({
  agentName,
  folders,
  existing,
  initialFolder,
  onClose,
  onCreated,
}: Readonly<{
  agentName: string;
  folders: readonly string[];
  existing: readonly string[];
  initialFolder: string;
  onClose: () => void;
  onCreated: (file: AgentFileDto) => void;
}>) {
  const [form] = Form.useForm<CreateFileForm>();
  const input = useRef<InputRef>(null);
  const [create, result] = useCreateAgentFileMutation();
  const folder = Form.useWatch("folder", form) ?? initialFolder;
  const name = Form.useWatch("name", form) ?? "";
  const path = joinPath(folder, name);
  const submit = async (input: CreateFileForm) => {
    try {
      onCreated(
        await create({ name: agentName, path: joinPath(input.folder, input.name) }).unwrap(),
      );
    } catch {
      /* The mutation error is rendered in the dialog. */
    }
  };
  const withExtension = (extension: string) => {
    const base = name.trim().replace(/\.[^./]*$/, "") || "untitled";
    form.setFieldValue("name", `${base}${extension}`);
    void form.validateFields(["name"]);
  };

  return (
    <Modal
      open
      title="New file"
      onCancel={onClose}
      destroyOnHidden
      afterOpenChange={(open) => open && input.current?.focus()}
      okText="Create file"
      okButtonProps={{ htmlType: "submit", loading: result.isLoading }}
      modalRender={(dialog) => (
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ folder: initialFolder, name: "" }}
          onFinish={(input) => void submit(input)}
        >
          {dialog}
        </Form>
      )}
    >
      <Form.Item name="folder" label="Folder" className="kx:mb-3">
        <Select
          showSearch
          options={[
            { value: "", label: "/ (agent root)" },
            ...folders.map((value) => ({ value, label: `${value}/` })),
          ]}
        />
      </Form.Item>
      <Form.Item
        name="name"
        label="File name"
        className="kx:mb-2"
        dependencies={["folder"]}
        rules={[
          { required: true, whitespace: true, message: "Enter a file name." },
          {
            validator: (_rule, value?: string) => {
              const full = joinPath(form.getFieldValue("folder") as string, value);
              if (!value?.trim()) return Promise.resolve();
              if (!isValidPath(full))
                return Promise.reject(
                  new Error(
                    "Use letters, digits, '.', '_' and '-'; add subfolders with '/', with no part starting with a dot.",
                  ),
                );
              if (existing.includes(full))
                return Promise.reject(new Error("A file with this name already exists."));
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input ref={input} maxLength={256} placeholder="review.ts or helpers/format.ts" />
      </Form.Item>
      <div className="kx:mb-4 kx:flex kx:items-center kx:gap-1">
        <Typography.Text type="secondary" className="kx:mr-1 kx:text-xs">
          Type:
        </Typography.Text>
        {EXTENSIONS.map((extension) => (
          <Button
            key={extension}
            size="small"
            type="dashed"
            onClick={() => withExtension(extension)}
          >
            {extension}
          </Button>
        ))}
      </div>
      <div
        className={`kx:mb-4 kx:flex kx:items-center kx:gap-2 kx:bg-surface-muted kx:px-3 kx:py-2 ${borderAll}`}
        aria-live="polite"
      >
        <FileTypeIcon path={path || "file"} />
        <Typography.Text className="kx:min-w-0 kx:truncate kx:font-mono kx:text-xs">
          <span className="kx:text-text-muted">agents/{agentName}/</span>
          {path || <span className="kx:text-text-muted">…</span>}
        </Typography.Text>
      </div>
      <Typography.Paragraph type="secondary" className="kx:mb-0 kx:text-xs">
        Missing folders are created for you.
      </Typography.Paragraph>
      {result.error && (
        <Alert className="kx:mt-4" type="error" showIcon title={errorMessage(result.error)} />
      )}
    </Modal>
  );
}
