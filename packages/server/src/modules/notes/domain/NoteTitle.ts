/** Largest note content accepted for saving, in characters. */
export const MAX_NOTE_CONTENT_LENGTH = 512 * 1024;

/**
 * A note's title: the first non-blank line of its markdown, without heading marks, at most
 * 200 characters. A note with no text is "Untitled".
 */
export class NoteTitle {
  static readonly maxLength = 200;
  readonly value: string;

  constructor(content: string) {
    const line = content
      .split("\n")
      .map((text) => text.replace(/^\s*#{1,6}\s+/, "").trim())
      .find((text) => text !== "");
    this.value = line ? line.slice(0, NoteTitle.maxLength) : "Untitled";
  }

  toString(): string {
    return this.value;
  }
}
