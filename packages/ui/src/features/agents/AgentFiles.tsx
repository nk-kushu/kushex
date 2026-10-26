import { Alert, Button, Form, Input, Modal, Tree, type TreeDataNode } from "antd";
import { useState } from "react";
import type { AgentFileDto, CreateAgentFileRequest } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import { useCreateAgentFileMutation } from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon } from "../../shared/lib/icons";
import { PaneHeader } from "../workbench/PaneHeader";

/** Same rule as the server: no `..`, no hidden files, at most 8 segments. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** Tree keys of the folders containing `path`, outermost first. */
const folderKeys = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_segment, index, parts) => `dir:${parts.slice(0, index + 1).join("/")}`);

const isValidPath = (path: string) =>
  path.length <= 512 &&
  path.split("/").length <= 8 &&
  path.split("/").every((segment) => SEGMENT.test(segment));

type Props = Readonly<{
  agentName: string;
  files: readonly AgentFileDto[];
  primaryFile: string;
  active: string;
  dirty: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onCreated: (file: AgentFileDto) => void;
}>;

/** The agent folder as a tree; folders are keyed `dir:<path>`, files by their path. */
export function AgentFiles({
  agentName,
  files,
  primaryFile,
  active,
  dirty,
  onOpen,
  onCreated,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<readonly string[]>(() => [
    ...new Set(files.flatMap((file) => folderKeys(file.path))),
  ]);
  // Opening a file, including a newly created one, reveals its folders.
  const [revealed, setRevealed] = useState(active);
  if (revealed !== active) {
    setRevealed(active);
    setExpanded((keys) => [...new Set([...keys, ...folderKeys(active)])]);
  }
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader
        title="Files"
        extra={
          <Button
            type="text"
            size="small"
            onClick={() => setCreating(true)}
            icon={<AppIcon icon={AddIcon} label="New file" />}
          />
        }
      />
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto kx:p-1">
        <Tree.DirectoryTree
          aria-label="Agent files"
          expandedKeys={[...expanded]}
          onExpand={(keys) => setExpanded(keys.map(String))}
          selectedKeys={[active]}
          onSelect={(_keys, { node }) => {
            if (node.isLeaf) onOpen(String(node.key));
          }}
          treeData={buildTree(
            files.map((file) => file.path),
            (path) =>
              `${path.split("/").at(-1)}${path === primaryFile ? " (primary)" : ""}${dirty.has(path) ? " ●" : ""}`,
          )}
        />
      </div>
      {creating && (
        <CreateFileDialog
          agentName={agentName}
          onClose={() => setCreating(false)}
          onCreated={(file) => {
            setCreating(false);
            onCreated(file);
          }}
        />
      )}
    </div>
  );
}

function buildTree(paths: readonly string[], label: (path: string) => string): TreeDataNode[] {
  type Folder = { folders: Map<string, Folder>; files: string[] };
  const root: Folder = { folders: new Map(), files: [] };
  for (const path of paths) {
    const segments = path.split("/");
    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      if (!folder.folders.has(segment))
        folder.folders.set(segment, { folders: new Map(), files: [] });
      folder = folder.folders.get(segment)!;
    }
    folder.files.push(path);
  }
  const nodes = (folder: Folder, prefix: string): TreeDataNode[] => [
    ...[...folder.folders].map(([name, child]) => ({
      key: `dir:${prefix}${name}`,
      title: name,
      selectable: false,
      children: nodes(child, `${prefix}${name}/`),
    })),
    ...folder.files.map((path) => ({ key: path, title: label(path), isLeaf: true })),
  ];
  return nodes(root, "");
}

function CreateFileDialog({
  agentName,
  onClose,
  onCreated,
}: Readonly<{
  agentName: string;
  onClose: () => void;
  onCreated: (file: AgentFileDto) => void;
}>) {
  const [form] = Form.useForm<CreateAgentFileRequest>();
  const [create, result] = useCreateAgentFileMutation();
  const path = Form.useWatch("path", form);
  const submit = async (input: CreateAgentFileRequest) => {
    try {
      onCreated(await create({ name: agentName, path: input.path }).unwrap());
    } catch {
      /* The mutation error is rendered in the dialog. */
    }
  };
  return (
    <Modal open title="New file" onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(input) => void submit(input)}>
        <Form.Item
          name="path"
          label="File path"
          extra={`Created as agents/${agentName}/${path || "<path>"}; folders are created as needed.`}
          rules={[
            { required: true, message: "Enter a path." },
            {
              validator: (_rule, value?: string) =>
                !value || isValidPath(value)
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error(
                        "Use letters, digits, '.', '_' and '-' separated by '/', with no part starting with a dot.",
                      ),
                    ),
            },
          ]}
        >
          <Input maxLength={512} placeholder="prompts/review.md" />
        </Form.Item>
        {result.error && (
          <Alert className="kx:mb-4" type="error" showIcon title={errorMessage(result.error)} />
        )}
        <Button htmlType="submit" type="primary" loading={result.isLoading}>
          Create file
        </Button>
      </Form>
    </Modal>
  );
}
