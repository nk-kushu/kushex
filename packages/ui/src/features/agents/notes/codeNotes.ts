/**
 * Code notes: markdown notes pinned to lines of an agent's files. All of an agent's notes are
 * one readable markdown document, stored in the database:
 *
 *     <!-- kushex-note id="k3x9q" file="tools/Search.ts" start="6" end="12" created="…" -->
 *     ### tools/Search.ts · lines 6–12
 *
 *     ```ts
 *     …the code the note points at…
 *     ```
 *
 *     The note, in markdown.
 *
 *     <!-- /kushex-note -->
 *
 * The snippet is what keeps a note on its code: when lines move, the note follows them.
 *
 * A general note is about the agent as a whole, so it has no file, lines or snippet:
 *
 *     <!-- kushex-note id="k3x9r" created="…" -->
 *     ### General
 *
 *     The note, in markdown.
 *
 *     <!-- /kushex-note -->
 */

export type CodeNote = Readonly<{
  id: string;
  /** Folder-relative path of the file the note is about; null for a general note. */
  file: string | null;
  /** 1-based, inclusive; 0 for a general note. */
  start: number;
  end: number;
  /** The code of `start`..`end` when the note was pinned. */
  snippet: string;
  /** Markdown. */
  body: string;
  created: string;
}>;

/** Where a note's code is now. */
export type NoteAnchor = Readonly<{
  start: number;
  end: number;
  /**
   * `exact`: the snippet is still on its lines; `moved`: it is elsewhere in the file;
   * `outdated`: the code changed, so the note shows on its old lines; `missing`: no such file;
   * `general`: the note has no code to point at.
   */
  status: "exact" | "moved" | "outdated" | "missing" | "general";
}>;

const HEADER = `# Code notes

Notes on this agent, kept by Kushex. Most point at lines of a file; edit them in the Notes view
of the agent editor.
`;
const OPEN = /<!-- kushex-note ((?:[a-z]+="[^"]*"\s*)*)-->\n([\s\S]*?)\n?<!-- \/kushex-note -->/g;
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g;
const CLOSE = "<!-- /kushex-note -->";

const attributeValue = (value: string) => value.replace(/"/g, "&quot;");
const unescape = (value: string) => value.replace(/&quot;/g, '"');

/** Notes in a notes document; blocks that are not notes are ignored. */
export function parseNotes(text: string): CodeNote[] {
  const notes: CodeNote[] = [];
  for (const [, attributes = "", inner = ""] of text.matchAll(OPEN)) {
    const attrs = Object.fromEntries(
      [...attributes.matchAll(ATTRIBUTE)].map(([, key = "", value = ""]) => [key, unescape(value)]),
    );
    if (!attrs.id) continue;
    const lines = inner.split("\n");
    if (!attrs.file) {
      // No snippet, so a code block here is part of the note.
      notes.push({
        id: attrs.id,
        file: null,
        start: 0,
        end: 0,
        snippet: "",
        body: lines
          .slice(lines[0]?.startsWith("#") ? 1 : 0)
          .join("\n")
          .trim(),
        created: attrs.created ?? "",
      });
      continue;
    }
    const start = Number(attrs.start);
    const end = Number(attrs.end);
    if (!(start >= 1) || !(end >= start)) continue;
    // The heading is for people reading the file; the fenced block is the snippet.
    let at = lines.findIndex((line) => /^`{3,}/.test(line));
    let snippet = "";
    if (at >= 0) {
      const fence = /^`+/.exec(lines[at]!)![0];
      const close = lines.findIndex((line, index) => index > at && line === fence);
      const last = close < 0 ? lines.length : close;
      snippet = lines.slice(at + 1, last).join("\n");
      at = last + 1;
    } else at = lines[0]?.startsWith("#") ? 1 : 0;
    notes.push({
      id: attrs.id,
      file: attrs.file,
      start,
      end,
      snippet,
      body: lines.slice(at).join("\n").trim(),
      created: attrs.created ?? "",
    });
  }
  return notes;
}

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  json: "json",
  md: "md",
};
const languageOf = (file: string) => LANGUAGES[file.split(".").at(-1) ?? ""] ?? "";

export const lineLabel = (note: Pick<CodeNote, "start" | "end">) =>
  note.start === note.end ? `line ${note.start}` : `lines ${note.start}–${note.end}`;

/** The notes document for `notes`: general notes first, then by file and line. */
export function serializeNotes(notes: readonly CodeNote[]): string {
  const sorted = [...notes].sort(
    (a, b) =>
      (a.file ?? "").localeCompare(b.file ?? "") ||
      a.start - b.start ||
      a.created.localeCompare(b.created),
  );
  const blocks = sorted.map((note) => {
    // A note cannot end its own block.
    const body = note.body.trim().replaceAll(CLOSE, "<!-- / kushex-note -->");
    if (note.file === null) {
      const id = `id="${attributeValue(note.id)}"`;
      const created = `created="${attributeValue(note.created)}"`;
      return [`<!-- kushex-note ${id} ${created} -->`, "### General", "", body, "", CLOSE].join(
        "\n",
      );
    }
    const longest = Math.max(0, ...[...note.snippet.matchAll(/`+/g)].map(([run]) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    const attributes = [
      ["id", note.id],
      ["file", note.file],
      ["start", String(note.start)],
      ["end", String(note.end)],
      ["created", note.created],
    ]
      .map(([key, value]) => `${key}="${attributeValue(value!)}"`)
      .join(" ");
    return [
      `<!-- kushex-note ${attributes} -->`,
      `### ${note.file} · ${lineLabel(note)}`,
      "",
      `${fence}${languageOf(note.file)}`,
      note.snippet,
      fence,
      "",
      body,
      "",
      CLOSE,
    ].join("\n");
  });
  return `${HEADER}\n${blocks.join("\n\n")}${blocks.length ? "\n" : ""}`;
}

const normalized = (text: string) => text.split("\n").map((line) => line.trimEnd());

/** Where `note` points in `content`, the file's current text (undefined: no such file). */
export function anchorNote(note: CodeNote, content: string | undefined): NoteAnchor {
  if (note.file === null) return { start: 0, end: 0, status: "general" };
  if (content === undefined) return { start: note.start, end: note.end, status: "missing" };
  const lines = normalized(content);
  const snippet = normalized(note.snippet);
  const size = snippet.length;
  const matchesAt = (index: number) =>
    snippet.every((line, offset) => lines[index + offset] === line);
  if (note.snippet && matchesAt(note.start - 1))
    return { start: note.start, end: note.start + size - 1, status: "exact" };
  if (note.snippet && snippet.some((line) => line.trim())) {
    let best = -1;
    for (let index = 0; index + size <= lines.length; index++)
      if (
        matchesAt(index) &&
        (best < 0 || Math.abs(index + 1 - note.start) < Math.abs(best + 1 - note.start))
      )
        best = index;
    if (best >= 0) return { start: best + 1, end: best + size, status: "moved" };
  }
  // The code changed: show the note where most of its lines still are, else where it was.
  const meaningful = snippet.filter((line) => line.trim()).length;
  let best = { index: -1, score: 0 };
  for (let index = 0; index + size <= lines.length; index++) {
    const score = snippet.filter(
      (line, offset) => line.trim() && lines[index + offset] === line,
    ).length;
    const nearer = Math.abs(index + 1 - note.start) < Math.abs(best.index + 1 - note.start);
    if (score > best.score || (score === best.score && score > 0 && nearer))
      best = { index, score };
  }
  if (meaningful > 0 && best.score * 2 >= meaningful)
    return { start: best.index + 1, end: best.index + size, status: "outdated" };
  const last = Math.max(1, lines.length);
  const start = Math.min(note.start, last);
  return { start, end: Math.min(Math.max(note.end, start), last), status: "outdated" };
}

/** The first line of a note as plain text, for lists and the editor. */
export function noteTitle(body: string, fallback = "Untitled note") {
  const line = body
    .split("\n")
    .map((text) =>
      text
        .replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "")
        .replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .find(Boolean);
  return line ?? fallback;
}

export const newNoteId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
