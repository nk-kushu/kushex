import { Alert, Button, Modal, TreeSelect, Typography } from "antd";
import { useState } from "react";
import type { DirectoryEntryDto } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import { useLazyTreeQuery, useTreeQuery } from "../../shared/api/kushexApi";

type Node = Readonly<{
  title: string;
  value: string;
  isLeaf: boolean;
  selectable: boolean;
  children?: Node[];
}>;

/** Picks workspace files to attach to a chat message; folders load as they are opened. */
export function AttachFilesDialog({
  projectId,
  initial,
  max,
  onClose,
  onAttach,
}: Readonly<{
  projectId: string;
  initial: readonly string[];
  max: number;
  onClose: () => void;
  onAttach: (files: readonly string[]) => void;
}>) {
  const root = useTreeQuery({ projectId, path: "" });
  const [fetchDirectory] = useLazyTreeQuery();
  const [folders, setFolders] = useState<ReadonlyMap<string, readonly DirectoryEntryDto[]>>(
    () => new Map(),
  );
  const [selected, setSelected] = useState<string[]>([...initial]);
  const [error, setError] = useState<string | null>(null);

  const load = async (path: string) => {
    try {
      // The first page only: very large folders are better narrowed by typing a path.
      const page = await fetchDirectory({ projectId, path }, true).unwrap();
      setFolders((current) => new Map(current).set(path, page.entries));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const nodes = (entries: readonly DirectoryEntryDto[] = []): Node[] =>
    entries.map((entry) => ({
      title: entry.name,
      value: entry.path,
      isLeaf: entry.kind === "file",
      selectable: entry.kind === "file",
      ...(folders.has(entry.path) ? { children: nodes(folders.get(entry.path)) } : {}),
    }));

  return (
    <Modal
      open
      title="Attach files"
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Button type="primary" onClick={() => onAttach(selected)}>
          Attach
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        The agent receives these workspace paths with the message; agents such as coding use them as
        the files they may read and change (at most {max}).
      </Typography.Paragraph>
      {(error || root.error) && (
        <Alert className="kx:mb-2" type="error" title={error ?? errorMessage(root.error)} />
      )}
      <TreeSelect<string[]>
        aria-label="Files"
        className="kx:w-full"
        multiple
        showSearch
        allowClear
        placeholder="Choose files"
        loading={root.isLoading}
        value={selected}
        onChange={(value) => setSelected(value.slice(0, max))}
        treeData={nodes(root.data?.entries)}
        loadData={(node) => load(String(node.value))}
        treeLoadedKeys={[...folders.keys()]}
      />
    </Modal>
  );
}
