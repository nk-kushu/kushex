/** A note's title as the server derives it: its first non-blank line without heading marks. */
export function noteTitle(content: string): string {
  const line = content
    .split("\n")
    .map((text) => text.replace(/^\s*#{1,6}\s+/, "").trim())
    .find((text) => text !== "");
  return line ? line.slice(0, 200) : "Untitled";
}

/** What a new note starts with; its heading becomes the title. */
export const NEW_NOTE = "# New note\n\n";
