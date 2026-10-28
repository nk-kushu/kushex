import {
  IconBrandJavascript,
  IconBrandTypescript,
  IconFile,
  IconFileText,
  IconFlask,
  IconFolder,
  IconFolderOpen,
  IconJson,
  IconMarkdown,
  IconPhoto,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

type FileKind = Readonly<{ icon: TablerIcon; color: string; label: string }>;

const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const KINDS: readonly (readonly [RegExp, FileKind])[] = [
  [TEST, { icon: IconFlask, color: "kx:text-[#2f9e5b]", label: "Test" }],
  [/\.[cm]?tsx?$/, { icon: IconBrandTypescript, color: "kx:text-[#3178c6]", label: "TypeScript" }],
  [/\.[cm]?jsx?$/, { icon: IconBrandJavascript, color: "kx:text-[#c9a215]", label: "JavaScript" }],
  [/\.jsonc?$/, { icon: IconJson, color: "kx:text-[#cb8a00]", label: "JSON" }],
  [/\.mdx?$/, { icon: IconMarkdown, color: "kx:text-[#4f8fc0]", label: "Markdown" }],
  [
    /\.(png|jpe?g|gif|svg|webp|ico)$/i,
    { icon: IconPhoto, color: "kx:text-[#9b6cc4]", label: "Image" },
  ],
  [
    /\.(txt|ya?ml|toml|env|ini|csv)$/i,
    { icon: IconFileText, color: "kx:text-text-muted", label: "Text" },
  ],
];
const OTHER: FileKind = { icon: IconFile, color: "kx:text-text-muted", label: "File" };

/** The icon and color of a file in the tree, tabs and breadcrumbs, by its name. */
export const fileKind = (path: string): FileKind =>
  KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? OTHER;

export function FileTypeIcon({ path, size = 16 }: Readonly<{ path: string; size?: number }>) {
  const { icon: Icon, color } = fileKind(path);
  return (
    <span aria-hidden className={`kx:inline-flex kx:shrink-0 ${color}`}>
      <Icon size={size} stroke={1.75} />
    </span>
  );
}

export function FolderIcon({ open, size = 16 }: Readonly<{ open: boolean; size?: number }>) {
  const Icon = open ? IconFolderOpen : IconFolder;
  return (
    <span aria-hidden className="kx:inline-flex kx:shrink-0 kx:text-[#d9a441]">
      <Icon size={size} stroke={1.75} />
    </span>
  );
}
