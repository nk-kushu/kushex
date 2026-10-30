import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentFileDto } from "@kushex/contracts";
import { KushexPanel } from "../../KushexPanel";
import { exampleAgent, mockKushexApi, textFile } from "../../test/mockApi";
import { parseNotes, serializeNotes } from "./notes/codeNotes";

const contentOf = (file: AgentFileDto | undefined) => (file?.kind === "text" ? file.content : null);

it("directs users to plugins when no agents are installed", async () => {
  mockKushexApi([], []);
  render(<KushexPanel initialPath="/agents" />);
  expect(await screen.findByText(/No agents yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse plugins" })).toHaveAttribute("href", "/plugins");
  expect(screen.queryByRole("button", { name: /New agent|Create agent/ })).not.toBeInTheDocument();
});

it("edits every file in the agent folder and adds new ones", async () => {
  const api = mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  const tree = await screen.findByRole("tree", { name: "Agent files" });
  expect(within(tree).getByRole("treeitem", { name: "agent.ts, entry point" })).toBeInTheDocument();
  expect(within(tree).getByRole("treeitem", { name: "prompts" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // Edit the primary file, then switch to a nested file without losing the draft.
  await user.type(screen.getByLabelText("agent.ts in reviewer"), "// edited");
  expect(
    within(tree).getByRole("treeitem", { name: "agent.ts, entry point, unsaved" }),
  ).toBeInTheDocument();
  await user.click(within(tree).getByText("review.ts"));
  const prompt = await screen.findByLabelText("prompts/review.ts in reviewer");
  expect(prompt).toHaveValue('export default "Review carefully.";\n');
  await user.type(prompt, "// tuned");
  await user.click(screen.getByRole("button", { name: /Save$/ }));
  await waitFor(() =>
    expect(
      within(tree).queryByRole("treeitem", { name: "review.ts, unsaved" }),
    ).not.toBeInTheDocument(),
  );
  const files = () => api.agents.get("reviewer")!.files;
  expect(contentOf(files().find((file) => file.path === "prompts/review.ts"))).toBe(
    'export default "Review carefully.";\n// tuned',
  );
  // The primary file is still unsaved; Save all writes it.
  expect(
    within(tree).getByRole("treeitem", { name: "agent.ts, entry point, unsaved" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save all" }));
  await waitFor(() =>
    expect(
      within(tree).getByRole("treeitem", { name: "agent.ts, entry point" }),
    ).toBeInTheDocument(),
  );
  expect(contentOf(files().find((file) => file.path === "agent.ts"))).toContain("// edited");

  await user.click(within(tree).getByText("logo.png"));
  expect(await screen.findByText("Binary file; it cannot be edited here.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "New file" }));
  await user.type(screen.getByLabelText("File name"), "../escape.ts");
  await user.click(screen.getByRole("button", { name: "Create file" }));
  expect(await screen.findByText(/no part starting with a dot/)).toBeInTheDocument();
  await user.clear(screen.getByLabelText("File name"));
  await user.type(screen.getByLabelText("File name"), "tools/search.ts");
  await user.click(screen.getByRole("button", { name: "Create file" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByLabelText("tools/search.ts in reviewer")).toHaveValue("");
  expect(files().some((file) => file.path === "tools/search.ts")).toBe(true);
});

it("reports when someone else saved a file first and can load the latest", async () => {
  const api = mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  const editor = await screen.findByLabelText("agent.ts in reviewer");
  api.agents.set("reviewer", {
    ...exampleAgent,
    files: exampleAgent.files.map((file) =>
      file.path === "agent.ts" ? textFile("agent.ts", "theirs", "f") : file,
    ),
  });
  await user.type(editor, " mine");
  await user.click(screen.getByRole("button", { name: /Save$/ }));
  expect(
    await screen.findByText("agent.ts: File changed since it was opened."),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Discard my changes and load latest" }));
  await waitFor(() => expect(screen.getByLabelText("agent.ts in reviewer")).toHaveValue("theirs"));
});

it("lists every breakpoint of the agent by file, with its code, and removes them", async () => {
  localStorage.setItem(
    "kushex:default:runs",
    JSON.stringify({
      breakpoints: { reviewer: { "agent.ts": [2], "prompts/review.ts": [1] } },
      watches: [],
      agents: {},
    }),
  );
  mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  // The Debug tab next to the files has them, also without a debug run.
  await user.click(await screen.findByRole("tab", { name: /^Debug/ }));
  const section = await screen.findByRole("region", { name: "Breakpoints" });
  expect(within(section).getByText("Breakpoints (2)")).toBeInTheDocument();
  expect(
    within(within(section).getByRole("list", { name: "Breakpoints in agent.ts" })).getByRole(
      "button",
      { name: "agent.ts:2" },
    ),
  ).toHaveTextContent("export default { prompt };2");
  expect(within(section).getByRole("button", { name: "prompts/review.ts:1" })).toHaveTextContent(
    'export default "Review carefully.";1',
  );

  // Opening one shows its file in the editor.
  await user.click(within(section).getByRole("button", { name: "prompts/review.ts:1" }));
  expect(await screen.findByLabelText("prompts/review.ts in reviewer")).toBeInTheDocument();

  await user.click(within(section).getByRole("button", { name: "Remove breakpoint agent.ts:2" }));
  expect(within(section).getByText("Breakpoints (1)")).toBeInTheDocument();
  await user.click(within(section).getByRole("button", { name: "Remove all breakpoints" }));
  expect(within(section).getByText(/Click left of a line number/)).toBeInTheDocument();
});

it("shows empty folders in the tree and offers them for new files", async () => {
  mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  const tree = await screen.findByRole("tree", { name: "Agent files" });
  expect(within(tree).getByRole("treeitem", { name: "workspace" })).toBeInTheDocument();

  await user.hover(within(tree).getByRole("treeitem", { name: "workspace" }));
  await user.click(within(tree).getByRole("button", { name: "New file in workspace" }));
  await user.type(await screen.findByLabelText("File name"), "scratch.ts");
  expect(screen.getByText("agents/reviewer/")).toBeInTheDocument();
  expect(screen.getByText("workspace/scratch.ts")).toBeInTheDocument();
});

it("filters the file tree, moves through it with the keyboard and closes open files", async () => {
  mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  const tree = await screen.findByRole("tree", { name: "Agent files" });

  await user.type(screen.getByLabelText("Filter files"), "review");
  expect(within(tree).queryByRole("treeitem", { name: /^agent\.ts/ })).not.toBeInTheDocument();
  expect(within(tree).getByRole("treeitem", { name: "review.ts" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("Filter files"), "{Escape}");
  expect(within(tree).getByRole("treeitem", { name: "agent.ts, entry point" })).toBeInTheDocument();

  // Folders first: prompts, its review.ts, then agent.ts and logo.png.
  within(tree).getByRole("treeitem", { name: "prompts" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(within(tree).getByRole("treeitem", { name: "prompts" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
  expect(await screen.findByLabelText("prompts/review.ts in reviewer")).toBeInTheDocument();

  const tabs = screen.getByRole("tablist", { name: "Open files" });
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["agent.ts", "review.ts"]);
  await user.click(screen.getByRole("button", { name: "Close prompts/review.ts" }));
  expect(await screen.findByLabelText("agent.ts in reviewer")).toBeInTheDocument();
});

it("lists code notes, shows one next to its code and saves edits to the database", async () => {
  const notes = serializeNotes([
    {
      id: "n1",
      file: "agent.ts",
      start: 2,
      end: 2,
      snippet: "export default { prompt };",
      body: "## Exports the agent\n\nKeep **one** default export.",
      created: "2026-10-28T10:00:00.000Z",
    },
  ]);
  const api = mockKushexApi([], [exampleAgent], { reviewer: notes });
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  // The tree marks files that have notes.
  expect(
    await screen.findByRole("treeitem", { name: "agent.ts, entry point, has notes" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /^Notes/ }));
  const list = screen.getByRole("region", { name: "Notes in agent.ts" });
  await user.click(within(list).getByRole("button", { name: /Exports the agent/ }));
  const panel = screen.getByRole("complementary", { name: "Code note" });
  expect(within(panel).getByRole("heading", { name: "Exports the agent" })).toBeInTheDocument();
  expect(within(panel).getByLabelText("Code the note points at")).toHaveTextContent(
    "2export default { prompt };",
  );

  await user.click(within(panel).getByRole("button", { name: "Edit note" }));
  const text = within(panel).getByLabelText("Note text");
  await user.clear(text);
  await user.type(text, "Renamed");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(panel).queryByLabelText("Note text")).not.toBeInTheDocument());
  expect(api.agents.get("reviewer")!.files.some((file) => file.path.endsWith(".md"))).toBe(false);
  expect(parseNotes(api.notes.get("reviewer")!.content)).toMatchObject([
    { id: "n1", file: "agent.ts", start: 2, body: "Renamed" },
  ]);
});

it("adds a general note that is not tied to any code", async () => {
  const api = mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  await screen.findByRole("tree", { name: "Agent files" });

  await user.click(screen.getByRole("tab", { name: /^Notes/ }));
  await user.click(await screen.findByRole("button", { name: "New note" }));
  const panel = screen.getByRole("complementary", { name: "General note" });
  expect(within(panel).queryByLabelText("Code the note points at")).not.toBeInTheDocument();

  await user.type(within(panel).getByLabelText("Note text"), "Try a smaller prompt");
  await user.click(within(panel).getByRole("button", { name: "Add note" }));
  const list = await screen.findByRole("region", { name: "General notes" });
  expect(within(list).getByRole("button", { name: /Try a smaller prompt/ })).toBeInTheDocument();
  expect(parseNotes(api.notes.get("reviewer")!.content)).toMatchObject([
    { file: null, body: "Try a smaller prompt" },
  ]);
  // It marks no file in the tree.
  expect(screen.queryByRole("treeitem", { name: /has notes/, hidden: true })).toBeNull();
});
