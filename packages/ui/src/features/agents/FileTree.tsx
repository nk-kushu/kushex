import { Tooltip } from "antd";
import { IconChevronRight, IconFilePlus, IconNote } from "@tabler/icons-react";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FileTypeIcon, FolderIcon } from "./fileIcons";

type Folder = Readonly<{ kind: "folder"; path: string; name: string; children: readonly Node[] }>;
type File = Readonly<{ kind: "file"; path: string; name: string }>;
type Node = Folder | File;
/** A node as it is shown: flattened, with its depth and place among its siblings. */
type Row = Readonly<{
  node: Node;
  depth: number;
  parent: string | null;
  index: number;
  count: number;
}>;

/** Row geometry, shared by the indent guides and the row padding. */
const INDENT = 14;
const GUTTER = 8;

const byName = (a: Node, b: Node) =>
  a.kind !== b.kind
    ? a.kind === "folder"
      ? -1
      : 1
    : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Folders and files from slash-separated paths; folders first, then by name. */
function buildTree(paths: readonly string[]): readonly Node[] {
  type Draft = { folders: Map<string, Draft>; files: string[] };
  const root: Draft = { folders: new Map(), files: [] };
  for (const path of paths) {
    let folder = root;
    for (const segment of path.split("/").slice(0, -1)) {
      if (!folder.folders.has(segment))
        folder.folders.set(segment, { folders: new Map(), files: [] });
      folder = folder.folders.get(segment)!;
    }
    folder.files.push(path);
  }
  const nodes = (draft: Draft, prefix: string): Node[] =>
    [
      ...[...draft.folders].map(([name, child]): Node => ({
        kind: "folder",
        path: `${prefix}${name}`,
        name,
        children: nodes(child, `${prefix}${name}/`),
      })),
      ...draft.files.map((path): Node => ({ kind: "file", path, name: path.split("/").at(-1)! })),
    ].sort(byName);
  return nodes(root, "");
}

/** Keeps files whose path contains `query`, and the folders leading to them. */
function filterTree(nodes: readonly Node[], query: string): readonly Node[] {
  return nodes.flatMap((node): Node[] => {
    if (node.kind === "file") return node.path.toLowerCase().includes(query) ? [node] : [];
    const children = filterTree(node.children, query);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function flatten(
  nodes: readonly Node[],
  isOpen: (folder: string) => boolean,
  depth = 0,
  parent: string | null = null,
): Row[] {
  return nodes.flatMap((node, index) => [
    { node, depth, parent, index, count: nodes.length },
    ...(node.kind === "folder" && isOpen(node.path)
      ? flatten(node.children, isOpen, depth + 1, node.path)
      : []),
  ]);
}

/** Every folder path containing one of `paths`. */
export const foldersOf = (paths: Iterable<string>) => {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_part, index) => folders.add(parts.slice(0, index + 1).join("/")));
  }
  return folders;
};

function Highlight({ text, query }: Readonly<{ text: string; query: string }>) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="kx:bg-primary/25 kx:text-text">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

type Props = Readonly<{
  label: string;
  paths: readonly string[];
  active: string;
  /** Open folders, by path. Ignored while filtering: every match is shown. */
  expanded: ReadonlySet<string>;
  onExpandedChange: (folder: string, open: boolean) => void;
  onOpen: (path: string) => void;
  onNewFileIn: (folder: string) => void;
  /** Lowercase text to filter paths by; empty shows everything. */
  filter: string;
  primaryFile: string;
  dirty: ReadonlySet<string>;
  withBreakpoints?: ReadonlySet<string>;
  /** Files that have code notes. */
  withNotes?: ReadonlySet<string>;
  empty: ReactNode;
}>;

/**
 * The agent folder as a keyboard-navigable tree, like VS Code's explorer: arrows move and
 * open or close folders, Enter opens a file, Home and End jump to the ends.
 */
export function FileTree({
  label,
  paths,
  active,
  expanded,
  onExpandedChange,
  onOpen,
  onNewFileIn,
  filter,
  primaryFile,
  dirty,
  withBreakpoints,
  withNotes,
  empty,
}: Props) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const shown = useMemo(() => (filter ? filterTree(tree, filter) : tree), [tree, filter]);
  const rows = flatten(shown, (folder) => !!filter || expanded.has(folder));
  const dirtyFolders = useMemo(() => foldersOf(dirty), [dirty]);
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());

  // The row that takes Tab focus: the last focused one, else the open file, else the first.
  const tabStop =
    rows.find((row) => row.node.path === focused)?.node.path ??
    rows.find((row) => row.node.path === active)?.node.path ??
    rows[0]?.node.path;

  const focus = (path: string | null | undefined) => {
    if (!path) return;
    setFocused(path);
    refs.current.get(path)?.focus();
  };
  const activate = (node: Node) => {
    if (node.kind === "file") onOpen(node.path);
    else if (!filter) onExpandedChange(node.path, !expanded.has(node.path));
  };

  const onKeyDown = (event: KeyboardEvent, at: number) => {
    const row = rows[at]!;
    const { node } = row;
    const open = node.kind === "folder" && (!!filter || expanded.has(node.path));
    const keys: Record<string, () => void> = {
      ArrowDown: () => focus(rows[at + 1]?.node.path),
      ArrowUp: () => focus(rows[at - 1]?.node.path),
      Home: () => focus(rows[0]?.node.path),
      End: () => focus(rows.at(-1)?.node.path),
      ArrowRight: () => {
        if (node.kind !== "folder") return;
        if (!open) onExpandedChange(node.path, true);
        else focus(rows[at + 1]?.node.path);
      },
      ArrowLeft: () => {
        if (open && !filter) onExpandedChange(node.path, false);
        else focus(row.parent);
      },
      Enter: () => activate(node),
      " ": () => activate(node),
    };
    const handle = keys[event.key];
    if (!handle) return;
    event.preventDefault();
    handle();
  };

  if (rows.length === 0) return <div className="kx:px-4 kx:py-6">{empty}</div>;

  return (
    <div role="tree" aria-label={label} className="kx:py-1 kx:select-none">
      {rows.map((row, at) => {
        const { node, depth } = row;
        const isFolder = node.kind === "folder";
        const open = isFolder && (!!filter || expanded.has(node.path));
        const selected = node.path === active;
        const primary = node.path === primaryFile;
        const unsaved = isFolder ? dirtyFolders.has(node.path) : dirty.has(node.path);
        const breakpoint = !isFolder && !!withBreakpoints?.has(node.path);
        const noted = !isFolder && !!withNotes?.has(node.path);
        const name = [
          node.name,
          primary && "entry point",
          unsaved && (isFolder ? "contains unsaved changes" : "unsaved"),
          breakpoint && "has breakpoints",
          noted && "has notes",
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={node.path}
            ref={(element) => {
              if (element) refs.current.set(node.path, element);
              else refs.current.delete(node.path);
            }}
            role="treeitem"
            aria-label={name}
            aria-level={depth + 1}
            aria-setsize={row.count}
            aria-posinset={row.index + 1}
            aria-expanded={isFolder ? open : undefined}
            aria-selected={isFolder ? undefined : selected}
            tabIndex={node.path === tabStop ? 0 : -1}
            title={node.path}
            onClick={() => {
              setFocused(node.path);
              activate(node);
            }}
            onKeyDown={(event) => onKeyDown(event, at)}
            className={`kx:group kx:relative kx:flex kx:h-[26px] kx:cursor-pointer kx:items-center kx:gap-1.5 kx:pr-2 kx:text-[13px] kx:outline-none kx:focus-visible:ring-1 kx:focus-visible:ring-primary kx:focus-visible:ring-inset ${
              selected
                ? "kx:bg-primary/12 kx:text-text kx:before:absolute kx:before:inset-y-0 kx:before:left-0 kx:before:w-0.5 kx:before:bg-primary"
                : "kx:text-text kx:hover:bg-fill"
            }`}
            style={{ paddingLeft: GUTTER + depth * INDENT }}
          >
            {Array.from({ length: depth }, (_guide, level) => (
              <span
                key={level}
                aria-hidden
                className="kx:absolute kx:inset-y-0 kx:w-px kx:bg-border kx:opacity-70"
                style={{ left: GUTTER + level * INDENT + 7 }}
              />
            ))}
            <span
              aria-hidden
              className={`kx:inline-flex kx:w-3.5 kx:shrink-0 kx:justify-center kx:text-text-muted kx:transition-transform kx:duration-150 ${
                open ? "kx:rotate-90" : ""
              }`}
            >
              {isFolder && <IconChevronRight size={14} stroke={2} />}
            </span>
            {isFolder ? <FolderIcon open={open} /> : <FileTypeIcon path={node.path} />}
            <span
              className={`kx:min-w-0 kx:flex-1 kx:truncate ${selected ? "kx:font-medium" : ""} ${
                unsaved && !isFolder ? "kx:text-primary" : ""
              }`}
            >
              <Highlight text={node.name} query={filter} />
            </span>
            {primary && (
              <Tooltip title="Entry point: the file the agent starts from">
                <span className="kx:shrink-0 kx:border kx:border-solid kx:border-primary/40 kx:px-1 kx:text-[10px] kx:leading-4 kx:font-medium kx:tracking-wide kx:text-primary kx:uppercase">
                  entry
                </span>
              </Tooltip>
            )}
            {noted && (
              <span
                aria-hidden
                title="Has code notes"
                className="kx:inline-flex kx:shrink-0 kx:text-text-muted"
              >
                <IconNote size={13} stroke={1.75} />
              </span>
            )}
            {breakpoint && (
              <span
                aria-hidden
                title="Has breakpoints"
                className="kx:size-2 kx:shrink-0 kx:rounded-full kx:bg-[#e51400]"
              />
            )}
            {unsaved && (
              <span
                aria-hidden
                title={isFolder ? "Contains unsaved changes" : "Unsaved changes"}
                className={`kx:size-2 kx:shrink-0 kx:rounded-full ${isFolder ? "kx:bg-primary/50" : "kx:bg-primary"}`}
              />
            )}
            {isFolder && (
              <Tooltip title={`New file in ${node.path}`}>
                <button
                  type="button"
                  aria-label={`New file in ${node.path}`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewFileIn(node.path);
                  }}
                  className="kx:hidden kx:size-5 kx:shrink-0 kx:cursor-pointer kx:items-center kx:justify-center kx:border-0 kx:bg-transparent kx:p-0 kx:text-text-muted kx:group-hover:inline-flex kx:hover:bg-fill kx:hover:text-text"
                >
                  <IconFilePlus size={14} stroke={1.75} />
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
