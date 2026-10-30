import { anchorNote, noteTitle, parseNotes, serializeNotes, type CodeNote } from "./codeNotes";

const note = (overrides: Partial<CodeNote> = {}): CodeNote => ({
  id: "n1",
  file: "tools/Search.ts",
  start: 2,
  end: 3,
  snippet: "const a = 1;\nconst b = 2;",
  body: "## Why\n\nThese are **magic** numbers.",
  created: "2026-10-28T10:00:00.000Z",
  ...overrides,
});

it("writes notes as readable markdown and reads them back", () => {
  const notes = [
    note(),
    note({
      id: "n2",
      file: "agent.ts",
      start: 1,
      end: 1,
      snippet: "x ``` y",
      body: "Fence inside",
    }),
  ];
  const text = serializeNotes(notes);
  expect(text).toContain("### tools/Search.ts · lines 2–3");
  expect(text).toContain("```ts\nconst a = 1;\nconst b = 2;\n```");
  // A snippet with a fence in it gets a longer fence.
  expect(text).toContain("````ts\nx ``` y\n````");
  expect(parseNotes(text)).toEqual([notes[1], notes[0]]);
});

it("keeps a note that would close its own block intact", () => {
  const text = serializeNotes([note({ body: "see <!-- /kushex-note --> here" })]);
  expect(parseNotes(text)).toHaveLength(1);
});

it("writes general notes first, without a file or lines, and keeps their code blocks", () => {
  const general = note({
    id: "n2",
    file: null,
    start: 0,
    end: 0,
    snippet: "",
    body: "# Ideas\n\n```ts\nconst keep = true;\n```\n\nMore text.",
  });
  const text = serializeNotes([note(), general]);
  expect(text).toContain(`<!-- kushex-note id="n2" created="${general.created}" -->\n### General`);
  expect(parseNotes(text)).toEqual([general, note()]);
  expect(anchorNote(general, undefined).status).toBe("general");
});

it("ignores hand-written text and broken blocks", () => {
  const text = `# Code notes\n\nSome prose.\n\n<!-- kushex-note id="x" file="a.ts" start="0" end="1" -->\nbad\n<!-- /kushex-note -->\n`;
  expect(parseNotes(text)).toEqual([]);
});

it("follows its code when lines move, and marks it outdated when the code changes", () => {
  const code = "// header\nconst a = 1;\nconst b = 2;\n";
  expect(anchorNote(note(), code)).toEqual({ start: 2, end: 3, status: "exact" });
  expect(anchorNote(note(), `// new\n// lines\n${code}`)).toEqual({
    start: 4,
    end: 5,
    status: "moved",
  });
  // Trailing whitespace does not count as a change.
  expect(anchorNote(note(), "// header\nconst a = 1;   \nconst b = 2;\n").status).toBe("exact");
  expect(anchorNote(note(), "// header\nconst a = 9;")).toEqual({
    start: 2,
    end: 2,
    status: "outdated",
  });
  // Edited in place after lines were added above: shown where most of it still is.
  expect(anchorNote(note(), "// new\n// header\nconst a = 1;\nconst b = 3;\n")).toEqual({
    start: 3,
    end: 4,
    status: "outdated",
  });
  expect(anchorNote(note(), undefined).status).toBe("missing");
});

it("picks the copy of the code nearest to where the note was", () => {
  const block = "const a = 1;\nconst b = 2;\n";
  const code = `${block}// gap\n// gap\n// gap\n${block}`;
  expect(anchorNote(note({ start: 7, end: 8 }), code)).toMatchObject({ start: 6, status: "moved" });
  expect(anchorNote(note({ start: 2, end: 3 }), code)).toMatchObject({ start: 1, status: "moved" });
});

it("titles a note by its first line of text", () => {
  expect(noteTitle("\n## Why **this**\nmore")).toBe("Why this");
  expect(noteTitle("- see [docs](https://x.y)")).toBe("see docs");
  expect(noteTitle("  ")).toBe("Untitled note");
});
