import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { KushexPanel } from "../../KushexPanel";
import { exampleAgent, exampleProject, FakeEventSource, mockKushexApi } from "../../test/mockApi";
import { recorded } from "../../test/debugEvents";

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
});

async function chooseAgent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByLabelText("Agent"));
  await user.click(await screen.findByTitle(name));
}

it("runs a chat message through the chosen agent and shows its progress and result", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  const chat = screen.getByRole("complementary", { name: "Chat" });
  expect(within(chat).getByText(/Choose an agent from your agents folder/)).toBeInTheDocument();

  await chooseAgent(user, "reviewer");
  await user.type(within(chat).getByLabelText("Message"), "Review the login flow");
  await user.click(within(chat).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toEqual({
    agentName: "reviewer",
    threadId: "thread-1",
    message: "Review the login flow",
    files: [],
    debug: false,
  });

  const stream = FakeEventSource.of("run-1");
  stream.emit({ type: "status", status: "running" });
  stream.emit({ type: "progress", message: "Reading the files" });
  stream.emit({ type: "output", stream: "stdout", text: "checked 3 files\n" });
  stream.emit({ type: "result", value: "Looks good.", truncated: false });
  stream.emit({ type: "status", status: "completed" });

  const run = await within(chat).findByLabelText("reviewer run");
  expect(within(run).getByText("Reading the files")).toBeInTheDocument();
  expect(within(run).getByText("Looks good.")).toBeInTheDocument();
  expect(within(run).getByText("completed")).toBeInTheDocument();
  expect(within(chat).getByText("Review the login flow")).toBeInTheDocument();
  // The stream closes once the run has finished.
  expect(stream.readyState).toBe(FakeEventSource.CLOSED);
});

it("sends on Enter and adds a new line on Shift+Enter", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");
  const message = screen.getByLabelText("Message");
  await user.type(message, "First line{Shift>}{Enter}{/Shift}second line");
  expect(message).toHaveValue("First line\nsecond line");
  expect(api.runs).toHaveLength(0);

  await user.keyboard("{Enter}");
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ message: "First line\nsecond line", debug: false });
  expect(message).toHaveValue("");
  FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });
});

it("reports a run that could not start", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");
  const served = api.fetch.getMockImplementation()!;
  api.fetch.mockImplementation(async (input) =>
    new Request(input).url.endsWith("/agent-runs")
      ? Response.json(
          { code: "CONFLICT", message: "A debug session is already running; stop it first." },
          { status: 409 },
        )
      : served(input),
  );
  await user.type(screen.getByLabelText("Message"), "Try again");
  await user.click(screen.getByRole("button", { name: "Start debugging" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(
    await screen.findByText("A debug session is already running; stop it first."),
  ).toBeInTheDocument();
});

it("debugs every message while enabled and stops the active debug run when switched off", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");

  // Enable before typing: this is a mode, not a one-message send button.
  await user.click(screen.getByRole("button", { name: "Start debugging" }));
  expect(screen.getByRole("button", { name: "Stop debugging" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(api.runs).toHaveLength(0);
  await user.type(screen.getByLabelText("Message"), "First message");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ message: "First message", debug: true });
  FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });

  // Normal send shortcut also follows the enabled mode for subsequent messages.
  await user.type(screen.getByLabelText("Message"), "Second message");
  await user.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(api.runs).toHaveLength(2));
  expect(api.runs[1]).toMatchObject({ message: "Second message", debug: true });
  await user.type(screen.getByLabelText("Message"), "Third message");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(api.runs).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "Stop debugging" }));
  await waitFor(() =>
    expect(api.debugRequests).toContainEqual(
      expect.objectContaining({ runId: "run-2", action: "cancel" }),
    ),
  );
  FakeEventSource.of("run-2").emit({ type: "status", status: "cancelled" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start debugging" })).toHaveAttribute(
      "aria-pressed",
      "false",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(3));
  expect(api.runs[2]).toMatchObject({ message: "Third message", debug: false });
  expect(api.runs[2]).not.toHaveProperty("breakpoints");
  FakeEventSource.of("run-3").emit({ type: "status", status: "completed" });
});

it("remembers the project's debugging mode when the chat is reopened", async () => {
  mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  const first = render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");
  await user.click(screen.getByRole("button", { name: "Start debugging" }));
  first.unmount();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  expect(screen.getByRole("button", { name: "Stop debugging" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("sends breakpoints saved in another tab after the project chat was opened", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");

  // Simulate the editor tab saving a breakpoint while this tab still has none.
  localStorage.setItem(
    "kushex:default:runs",
    JSON.stringify({
      breakpoints: { reviewer: { "agent.ts": [47] } },
      watches: [],
      agents: { [exampleProject.id]: "reviewer" },
    }),
  );
  await user.type(screen.getByLabelText("Message"), "Debug the guard");
  await user.click(screen.getByRole("button", { name: "Start debugging" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ debug: true, breakpoints: { "agent.ts": [47] } });
  FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });
});

it("debugs an agent: breakpoints go with the run, the agent editor follows the pause, and the debugger steps", async () => {
  localStorage.setItem(
    "kushex:default:runs",
    JSON.stringify({
      breakpoints: { reviewer: { "agent.ts": [2] } },
      watches: ["prompt.length"],
      agents: { [exampleProject.id]: "reviewer" },
    }),
  );
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.variables["scope-1"] = [
    { name: "prompt", type: "string", value: '"Review carefully."', ref: null },
    { name: "options", type: "object", value: "{depth: 2}", ref: "object-1" },
  ];
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));

  // The project's chat still has the agent chosen before.
  const chat = screen.getByRole("complementary", { name: "Chat" });
  await user.type(within(chat).getByLabelText("Message"), "Review the prompt");
  await user.click(within(chat).getByRole("button", { name: "Start debugging" }));
  await user.click(within(chat).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ debug: true, breakpoints: { "agent.ts": [2] } });

  const stream = FakeEventSource.of("run-1");
  stream.emit({ type: "status", status: "running" });
  stream.emit({
    type: "breakpoints",
    breakpoints: [{ file: "agent.ts", requestedLine: 2, line: 2, verified: true }],
  });
  stream.emit({ type: "status", status: "paused" });
  stream.emit({
    type: "paused",
    reason: "breakpoint",
    frames: [
      {
        id: "frame-0",
        name: "review",
        location: {
          file: "prompts/review.ts",
          url: "file:///agents/reviewer/prompts/review.ts",
          scriptId: "7",
          line: 1,
          column: 1,
        },
        scopes: [{ type: "local", name: "Local", ref: "scope-1" }],
      },
      {
        id: "frame-1",
        name: "chat",
        location: {
          file: "agent.ts",
          url: "file:///agents/reviewer/agent.ts",
          scriptId: "6",
          line: 2,
          column: 3,
        },
        scopes: [],
      },
    ],
  });

  expect(
    await within(chat).findByText("Paused on breakpoint at review (prompts/review.ts:1)"),
  ).toBeInTheDocument();
  await user.click(within(chat).getByRole("button", { name: "Open debugger" }));
  // The agent page has no chat; the agent editor shows the paused file and the debugger.
  expect(screen.queryByRole("complementary", { name: "Chat" })).not.toBeInTheDocument();
  const debug = await screen.findByRole("region", { name: "Debugger" });
  expect(await screen.findByLabelText("prompts/review.ts in reviewer")).toBeInTheDocument();
  expect(within(debug).getByText("paused on breakpoint")).toBeInTheDocument();
  const stack = within(debug).getByRole("list", { name: "Call stack" });
  expect(within(stack).getByText("review")).toBeInTheDocument();
  expect(within(stack).getByText("agent.ts:2")).toBeInTheDocument();
  expect(await within(debug).findByText("prompt")).toBeInTheDocument();
  expect(within(debug).getByText('"Review carefully."')).toBeInTheDocument();

  // Picking a caller shows its file.
  await user.click(within(stack).getByText("chat"));
  expect(await screen.findByLabelText("agent.ts in reviewer")).toBeInTheDocument();

  // Watches evaluate in the selected frame.
  const watch = within(debug).getByRole("region", { name: "Watch" });
  expect(await within(watch).findByText("prompt.length = 2")).toBeInTheDocument();
  expect(api.debugRequests).toContainEqual(
    expect.objectContaining({
      action: "evaluate",
      body: { expression: "prompt.length", frameId: "frame-1" },
    }),
  );

  // The debug console is under the editor.
  const debugConsole = screen.getByRole("region", { name: "Debug console" });
  await user.type(within(debugConsole).getByLabelText("Evaluate expression"), "1 + 1{Enter}");
  expect(await within(debugConsole).findByText("1 + 1 = 2")).toBeInTheDocument();

  // The Breakpoints section of the debug view shows them during the session too.
  const breakpoints = within(debug).getByRole("region", { name: "Breakpoints" });
  expect(within(breakpoints).getByRole("button", { name: "agent.ts:2" })).toHaveTextContent(
    "export default { prompt };2",
  );

  await user.click(within(debug).getByRole("button", { name: "Step over" }));
  await waitFor(() =>
    expect(api.debugRequests).toContainEqual(
      expect.objectContaining({ action: "debug", body: { command: "stepOver" } }),
    ),
  );

  stream.emit({ type: "resumed" });
  stream.emit({ type: "result", value: "done", truncated: false });
  stream.emit({ type: "status", status: "completed" });
  expect(await within(debug).findByText("completed")).toBeInTheDocument();
  await user.click(within(debug).getByRole("button", { name: "Close" }));
  // The debug view stays, without the run.
  expect(screen.queryByRole("region", { name: "Debug console" })).not.toBeInTheDocument();
  expect(within(debug).getByText(/Turn on debugging in the chat/)).toBeInTheDocument();
});

it("opens a run's debug events from the chat", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.debugEvents["run-1"] = [
    recorded(1, "operation.started", "debug", { operation: "agent.run" }),
    recorded(2, "progress.reported", "info", { summary: "Reading the files" }),
    recorded(3, "operation.completed", "debug", { operation: "model.call", durationMs: 812 }),
  ];
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");
  await user.type(screen.getByLabelText("Message"), "Review{Enter}");
  FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });

  const run = await screen.findByLabelText("reviewer run");
  await user.click(within(run).getByRole("button", { name: "Debug events" }));
  const timeline = await screen.findByRole("list", { name: "Debug events" });
  expect(within(timeline).getByText("Reading the files")).toBeInTheDocument();
  expect(within(timeline).getByText("812 ms")).toBeInTheDocument();
  // Span starts are folded into their completion unless shown.
  expect(within(timeline).queryByText(/agent\.run/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "Show span starts" }));
  expect(within(timeline).getByText(/agent\.run/)).toBeInTheDocument();

  await user.type(screen.getByLabelText("Filter events"), "model");
  expect(within(timeline).queryByText("Reading the files")).not.toBeInTheDocument();
  // The chat stays open next to the timeline.
  expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
});

it("loads a saved thread and restores its messages and reply", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.threads.push({
    id: "saved-thread",
    projectId: exampleProject.id,
    title: "Saved question",
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    turns: [
      {
        id: "saved-run",
        agentName: "reviewer",
        message: "What did you find?",
        files: [],
        debug: false,
        createdAt: "2026-10-26T00:00:00.000Z",
        events: [
          { type: "result", value: "Saved answer", truncated: false },
          { type: "status", status: "completed" },
        ],
      },
    ],
  });
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(screen.getByLabelText("Chat thread"));
  await user.click(await screen.findByTitle("Saved question"));
  expect(await screen.findByText("Saved answer")).toBeInTheDocument();
  expect(screen.getByText("What did you find?")).toBeInTheDocument();
});

const codingResult = {
  outcome: { status: "finished", outcome: { status: "completed" } },
  result: {
    summary: "Updated the answer",
    changedPaths: ["src/index.ts", "new.ts"],
    unresolved: [],
  },
};

it("reviews a completed coding run, selects files, applies the reviewed digest and refreshes an open file", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.proposals["run-1"] = {
    id: "run-1",
    digest: "a".repeat(64),
    summary: "Updated the answer",
    status: "ready",
    changes: [
      {
        path: "src/index.ts",
        before: "export const answer = 42;",
        after: "export const answer = 43;",
      },
      { path: "new.ts", before: null, after: "export const added = true;" },
    ],
  };
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  // Keep a file open to verify publication invalidates its query.
  await user.dblClick(await screen.findByText("src"));
  await user.click(await screen.findByText("index.ts"));
  expect(await screen.findByText("export const answer = 42;")).toBeInTheDocument();
  await chooseAgent(user, "reviewer");
  await user.type(screen.getByLabelText("Message"), "Update the answer");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  const stream = FakeEventSource.of("run-1");
  act(() => {
    stream.emit({ type: "result", value: codingResult, truncated: false });
    stream.emit({ type: "status", status: "completed" });
  });
  const button = await screen.findByRole("button", { name: "Review changes" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByLabelText("Original")).toHaveTextContent(
    "export const answer = 42;",
  );
  expect(within(dialog).getByLabelText("Proposed")).toHaveTextContent("export const answer = 43;");
  expect(api.proposalApplies).toEqual([]);
  await user.click(within(dialog).getByLabelText("Changed file"));
  await user.click(await screen.findByTitle("new.ts (new file)"));
  expect(within(dialog).getByLabelText("Proposed")).toHaveTextContent("export const added = true;");
  await user.click(within(dialog).getByRole("button", { name: "Accept and apply" }));
  expect(await within(dialog).findByText("Changes applied to the project.")).toBeInTheDocument();
  expect(api.proposalApplies).toEqual([{ runId: "run-1", digest: "a".repeat(64) }]);
  await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
  await waitFor(() => expect(screen.getByText("export const answer = 43;")).toBeInTheDocument());
});

it("reopens persisted coding reviews and disables apply for conflicts", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.proposals["old-run"] = {
    id: "old-run",
    digest: "b".repeat(64),
    summary: "Updated the answer",
    status: "not-applied",
    code: "TARGET_CHANGED",
    changes: [{ path: "a.ts", before: "old", after: "new" }],
  };
  api.threads.push({
    id: "saved-thread",
    projectId: exampleProject.id,
    title: "Saved changes",
    createdAt: "2026-10-28",
    updatedAt: "2026-10-28",
    turns: [
      {
        id: "old-run",
        agentName: "reviewer",
        message: "Update the answer",
        files: [],
        debug: false,
        createdAt: "2026-10-28",
        events: [
          { type: "result", value: codingResult, truncated: false },
          { type: "status", status: "completed" },
        ],
      },
    ],
  });
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(screen.getByLabelText("Chat thread"));
  await user.click(await screen.findByTitle("Saved changes"));
  const review = await screen.findByRole("button", { name: "Review changes" });
  await waitFor(() => expect(review).toBeEnabled());
  await user.click(review);
  const dialog = await screen.findByRole("dialog");
  expect(
    await within(dialog).findByText("Project files changed since this proposal was prepared."),
  ).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Accept and apply" })).toBeDisabled();
  expect(api.proposalApplies).toEqual([]);
});

it("checks a lost apply response without sending a second approval", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.proposals["run-1"] = {
    id: "run-1",
    digest: "c".repeat(64),
    summary: "Updated the answer",
    status: "ready",
    changes: [{ path: "src/index.ts", before: "old", after: "new" }],
  };
  const served = api.fetch.getMockImplementation()!;
  api.fetch.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const response = await served(input);
    if (new URL(request.url).pathname.endsWith("/proposal/apply"))
      throw new TypeError("Lost response");
    return response;
  });
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await chooseAgent(user, "reviewer");
  await user.type(screen.getByLabelText("Message"), "Update{Enter}");
  act(() => {
    FakeEventSource.of("run-1").emit({ type: "result", value: codingResult, truncated: false });
    FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });
  });
  const review = await screen.findByRole("button", { name: "Review changes" });
  await waitFor(() => expect(review).toBeEnabled());
  await user.click(review);
  const dialog = await screen.findByRole("dialog");
  const accept = within(dialog).getByRole("button", { name: "Accept and apply" });
  await waitFor(() => expect(accept).toBeEnabled());
  await user.click(accept);
  expect(await within(dialog).findByText("Application outcome is pending")).toBeInTheDocument();
  expect(accept).toBeDisabled();
  const check = within(dialog).getByRole("button", { name: "Check application status" });
  await waitFor(() => expect(check).toBeEnabled());
  await user.click(check);
  expect(await within(dialog).findByText("Changes applied to the project.")).toBeInTheDocument();
  expect(api.proposalApplies).toHaveLength(1);
  expect(api.proposalChecks).toHaveLength(1);
});
