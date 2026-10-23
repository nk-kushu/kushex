import { Button, Tree, type TreeDataNode } from "antd";
import { useAppDispatch } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon } from "../../shared/lib/icons";
import { PaneHeader } from "../workbench/PaneHeader";
import { fileTabOpened } from "../workbench/workbenchSlice";

const tree: TreeDataNode[] = [
  {
    title: "folder",
    key: "folder",
    children: [
      { title: "file.ts", key: "folder/file.ts", isLeaf: true },
      { title: "other.ts", key: "folder/other.ts", isLeaf: true },
    ],
  },
  { title: "folder-two", key: "folder-two", children: [{ title: "file.ts", key: "folder-two/file.ts", isLeaf: true }] },
  { title: "README.md", key: "README.md", isLeaf: true },
];

export function FilesSide() {
  const dispatch = useAppDispatch();
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader title="Files" extra={<Button type="text" size="small" icon={<AppIcon icon={AddIcon} label="New file" />} />} />
      <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto kx:p-1">
        <Tree.DirectoryTree
          treeData={tree}
          defaultExpandedKeys={["folder"]}
          onSelect={(_keys, { node }) => {
            if (node.isLeaf) dispatch(fileTabOpened({ key: `file:${String(node.key)}`, title: String(node.title), kind: "file" }));
          }}
        />
      </div>
    </div>
  );
}
