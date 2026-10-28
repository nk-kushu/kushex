import { Tree, type TreeDataNode } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import type { DebugValueDto } from "@kushex/contracts";
import { errorMessage } from "../../../shared/api/errorMessage";
import { useLazyDebugVariablesQuery } from "../../../shared/api/kushexApi";

export type ValueRoot = Readonly<{
  key: string;
  name: ReactNode;
  /** Omitted for scopes, which show only their name. */
  value?: DebugValueDto;
  /** Properties to list when expanded; null when there are none. */
  ref: string | null;
  extra?: ReactNode;
}>;

type Child = Readonly<{ key: string; name: string; value: DebugValueDto }>;

const VALUE_COLORS: Record<string, string> = {
  string: "kx:text-[#a31515] kx:dark:text-[#ce9178]",
  number: "kx:text-[#098658] kx:dark:text-[#b5cea8]",
  bigint: "kx:text-[#098658] kx:dark:text-[#b5cea8]",
  boolean: "kx:text-[#0000ff] kx:dark:text-[#569cd6]",
  undefined: "kx:text-text-muted",
  null: "kx:text-text-muted",
  error: "kx:text-[#e51400]",
};

export function ValueLabel({
  name,
  value,
  extra,
}: Readonly<{ name: ReactNode; value?: DebugValueDto; extra?: ReactNode }>) {
  return (
    <span className="kx:inline-flex kx:max-w-full kx:items-center kx:gap-1 kx:font-mono kx:text-xs">
      <span className="kx:text-[#795e26] kx:dark:text-[#9cdcfe]">{name}</span>
      {value && (
        <>
          {name !== "" && <span className="kx:text-text-muted">:</span>}
          <span className={`kx:truncate ${VALUE_COLORS[value.type] ?? ""}`} title={value.value}>
            {value.value}
          </span>
        </>
      )}
      {extra}
    </span>
  );
}

/**
 * Values the way a debugger shows them: objects expand into their properties, fetched while
 * the run stays paused at `pause`. A new pause makes the fetched properties stale, so
 * callers key this component by it.
 */
export function ValueTree({
  runId,
  pause,
  roots,
  defaultExpanded = [],
  ariaLabel,
}: Readonly<{
  runId: string;
  pause: number;
  roots: readonly ValueRoot[];
  defaultExpanded?: readonly string[];
  ariaLabel: string;
}>) {
  const [fetchVariables] = useLazyDebugVariablesQuery();
  const [children, setChildren] = useState<ReadonlyMap<string, readonly Child[] | string>>(
    () => new Map(),
  );
  const [expanded, setExpanded] = useState<readonly string[]>(defaultExpanded);
  const refs = new Map<string, string>();

  const load = async (key: string, ref: string) => {
    try {
      const page = await fetchVariables({ runId, ref, pause }, true).unwrap();
      setChildren((current) =>
        new Map(current).set(
          key,
          page.entries.map((entry) => ({
            key: `${key}/${entry.name}`,
            name: entry.name,
            value: entry,
          })),
        ),
      );
    } catch (failure) {
      setChildren((current) => new Map(current).set(key, errorMessage(failure)));
    }
  };

  // Expanded by default (e.g. the Local scope) means loaded at once.
  useEffect(() => {
    for (const root of roots)
      if (root.ref && defaultExpanded.includes(root.key) && !children.has(root.key))
        void load(root.key, root.ref);
    // Only when the roots change: a new pause or watch remounts or replaces them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

  const node = (key: string, label: ReactNode, ref: string | null): TreeDataNode => {
    if (ref) refs.set(key, ref);
    const loaded = children.get(key);
    return {
      key,
      title: label,
      isLeaf: !ref,
      ...(typeof loaded === "string"
        ? {
            children: [
              {
                key: `${key}/\0error`,
                isLeaf: true,
                title: <span className="kx:text-xs">{loaded}</span>,
              },
            ],
          }
        : loaded
          ? {
              children: loaded.map((child) =>
                node(
                  child.key,
                  <ValueLabel name={child.name} value={child.value} />,
                  child.value.ref,
                ),
              ),
            }
          : {}),
    };
  };
  const treeData = roots.map((root) =>
    node(root.key, <ValueLabel name={root.name} value={root.value} extra={root.extra} />, root.ref),
  );

  return (
    <Tree
      aria-label={ariaLabel}
      blockNode
      selectable={false}
      treeData={treeData}
      expandedKeys={[...expanded]}
      loadedKeys={[...children.keys()]}
      onExpand={(keys) => setExpanded(keys.map(String))}
      loadData={async (treeNode) => {
        const key = String(treeNode.key);
        const ref = refs.get(key);
        if (ref && !children.has(key)) await load(key, ref);
      }}
    />
  );
}
