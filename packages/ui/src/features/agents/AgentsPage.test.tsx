import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentFileDto } from "@kushex/contracts";
import { KushexPanel } from "../../KushexPanel";
import { exampleAgent, mockKushexApi, textFile } from "../../test/mockApi";

const contentOf = (file: AgentFileDto | undefined) => (file?.kind === "text" ? file.content : null);

it("creates a named agent and opens its primary file in the editor", async () => {
  const api = mockKushexApi([], []);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents" />);
  expect(await screen.findByText(/No agents yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New agent" }));
  await user.type(screen.getByLabelText("Agent name"), "Bad Name");
  await user.click(screen.getByRole("button", { name: "Create agent" }));
  expect(await screen.findByText(/Use lowercase letters/)).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Agent name"));
  await user.type(screen.getByLabelText("Agent name"), "planner");
  expect(screen.getByText("Saved as agents/planner/agent.ts")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByLabelText("agent.ts in planner")).toHaveValue(
    'export default { name: "planner" };\n',
  );
  expect(within(screen.getByRole("menu", { name: "Agents" })).getByText("planner")).toBeVisible();
  expect(api.agents.has("planner")).toBe(true);
});

it("edits every file in the agent folder and adds new ones", async () => {
  const api = mockKushexApi([], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/agents/reviewer" />);
  const tree = await screen.findByRole("tree", { name: "Agent files" });
  expect(within(tree).getByText("agent.ts (primary)")).toBeInTheDocument();
  expect(within(tree).getByText("prompts")).toBeInTheDocument();

  // Edit the primary file, then switch to a nested file without losing the draft.
  await user.type(screen.getByLabelText("agent.ts in reviewer"), "// edited");
  expect(within(tree).getByText("agent.ts (primary) ●")).toBeInTheDocument();
  await user.click(within(tree).getByText("review.ts"));
  const prompt = await screen.findByLabelText("prompts/review.ts in reviewer");
  expect(prompt).toHaveValue('export default "Review carefully.";\n');
  await user.type(prompt, "// tuned");
  await user.click(screen.getByRole("button", { name: /Save$/ }));
  await waitFor(() => expect(within(tree).queryByText("review.ts ●")).not.toBeInTheDocument());
  const files = () => api.agents.get("reviewer")!.files;
  expect(contentOf(files().find((file) => file.path === "prompts/review.ts"))).toBe(
    'export default "Review carefully.";\n// tuned',
  );
  // The primary file is still unsaved; Save all writes it.
  expect(within(tree).getByText("agent.ts (primary) ●")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save all" }));
  await waitFor(() => expect(within(tree).getByText("agent.ts (primary)")).toBeInTheDocument());
  expect(contentOf(files().find((file) => file.path === "agent.ts"))).toContain("// edited");

  await user.click(within(tree).getByText("logo.png"));
  expect(await screen.findByText("Binary file; it cannot be edited here.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "New file" }));
  await user.type(screen.getByLabelText("File path"), "../escape.ts");
  await user.click(screen.getByRole("button", { name: "Create file" }));
  expect(await screen.findByText(/no part starting with a dot/)).toBeInTheDocument();
  await user.clear(screen.getByLabelText("File path"));
  await user.type(screen.getByLabelText("File path"), "tools/search.ts");
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
