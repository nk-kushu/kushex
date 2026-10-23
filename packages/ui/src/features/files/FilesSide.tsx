import { Alert, Button, Empty, Spin, Tree, type TreeDataNode } from "antd";
import { useState } from "react";
import type { DirectoryEntryDto, DirectoryPageDto } from "@kushex/contracts";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import { useLazyTreeQuery, useTreeQuery } from "../../shared/api/kushexApi";
import { PaneHeader } from "../workbench/PaneHeader";
import { fileTabOpened, selectProjectId } from "../workbench/workbenchSlice";

export function FilesSide() {
  const projectId = useAppSelector(selectProjectId);
  const [revision, setRevision] = useState(0);
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader
        title="Files"
        extra={
          <Button
            size="small"
            onClick={() => setRevision((value) => value + 1)}
            disabled={!projectId}
          >
            Refresh files
          </Button>
        }
      />
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto kx:p-1">
        {projectId ? (
          <WorkspaceTree key={`${projectId}:${revision}`} projectId={projectId} />
        ) : (
          <Empty description="Open a project first" />
        )}
      </div>
    </div>
  );
}

function WorkspaceTree({ projectId }: Readonly<{ projectId: string }>) {
  const dispatch = useAppDispatch();
  const root = useTreeQuery({ projectId, path: "" }, { refetchOnMountOrArgChange: true });
  const [fetchDirectory] = useLazyTreeQuery();
  const [pages, setPages] = useState<Map<string, DirectoryPageDto>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async (path: string, offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchDirectory({ projectId, path, offset }, false).unwrap();
      setPages((current) =>
        new Map(current).set(path, {
          entries: offset
            ? [
                ...(current.get(path)?.entries ??
                  (path === "" ? root.currentData?.entries : []) ??
                  []),
                ...page.entries,
              ]
            : page.entries,
          nextOffset: page.nextOffset,
        }),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  };
  const nodes = (path: string, page?: DirectoryPageDto): TreeDataNode[] => {
    if (!page) return [];
    const result: TreeDataNode[] = page.entries.map((entry: DirectoryEntryDto) => ({
      title: entry.name,
      key: entry.path,
      isLeaf: entry.kind === "file",
      ...(entry.kind === "directory" && pages.get(entry.path)
        ? { children: nodes(entry.path, pages.get(entry.path)) }
        : {}),
    }));
    if (page.nextOffset !== null)
      result.push({
        key: `\0page:${path}`,
        isLeaf: true,
        selectable: false,
        title: (
          <Button
            type="link"
            size="small"
            loading={loading}
            onClick={(event) => {
              event.stopPropagation();
              void load(path, page.nextOffset!);
            }}
          >
            Load more entries
          </Button>
        ),
      });
    return result;
  };
  if (root.isLoading) return <Spin aria-label="Loading files" />;
  if (root.error)
    return (
      <Alert
        type="error"
        title={errorMessage(root.error)}
        action={<Button onClick={() => void root.refetch()}>Retry</Button>}
      />
    );
  const rootPage = pages.get("") ?? root.currentData;
  return (
    <>
      {error && <Alert closable onClose={() => setError(null)} type="error" title={error} />}
      {rootPage?.entries.length === 0 && <Empty description="This directory is empty" />}
      <Tree.DirectoryTree
        treeData={nodes("", rootPage)}
        loadedKeys={[...pages.keys()].filter(Boolean)}
        loadData={(node) => load(String(node.key))}
        onSelect={(_keys, { node }) => {
          if (node.isLeaf && node.selectable !== false) {
            const path = String(node.key);
            dispatch(
              fileTabOpened({
                key: `file:${path}`,
                path,
                title: path.split("/").at(-1) ?? path,
                kind: "file",
              }),
            );
          }
        }}
      />
    </>
  );
}
