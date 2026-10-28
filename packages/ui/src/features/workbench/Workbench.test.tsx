import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { mockKushexApi } from "../../test/mockApi";
import { KushexPanel } from "../../KushexPanel";
import type { KushexPanelHandle } from "../../types";

beforeEach(() => {
  mockKushexApi();
});

describe("Workbench", () => {
  it("opens a project into Files with the side view, editor and chat", async () => {
    const user = userEvent.setup();
    render(<KushexPanel />);
    await user.click(await screen.findByRole("button", { name: "Open Project one" }));

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Open a file from the tree")).toBeInTheDocument();
    await user.dblClick(await screen.findByText("src"));
    await user.click(await screen.findByText("index.ts"));
    expect(await screen.findByLabelText("src/index.ts contents")).toHaveTextContent(
      "export const answer = 42;",
    );
    expect(screen.getByLabelText("src/index.ts contents")).not.toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Project one · alpha");
  });

  it("switches screens from the activity bar", async () => {
    const user = userEvent.setup();
    render(<KushexPanel />);
    const activities = screen.getByRole("navigation", { name: "Activities" });

    await user.click(within(activities).getByRole("button", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In review" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Chat" })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Open Task title" })[0]!);
    expect(screen.getByRole("button", { name: "Start with agent" })).toBeInTheDocument();

    await user.click(within(activities).getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("textbox", { name: "Note text" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();

    await user.click(within(activities).getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("makes activities links that open in a new tab when pages have URLs", async () => {
    window.history.replaceState(null, "", "/kushex/projects");
    const user = userEvent.setup();
    render(<KushexPanel router="browser" basename="/kushex" />);
    const activities = screen.getByRole("navigation", { name: "Activities" });

    // Middle-click, Ctrl/Cmd-click and "Open in new tab" use the link's URL.
    expect(within(activities).getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/kushex/agents",
    );
    expect(within(activities).getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // A plain click still switches the page inside the panel.
    await user.click(within(activities).getByRole("link", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/kushex/settings");
    expect(within(activities).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Workbench on a narrow screen", () => {
  it("shows one region at a time with a bottom section bar", async () => {
    window.innerWidth = 375;
    const user = userEvent.setup();
    render(<KushexPanel />);
    const sections = screen.getByRole("navigation", { name: "Sections" });
    expect(screen.queryByRole("navigation", { name: "Activities" })).not.toBeInTheDocument();

    await user.click(within(sections).getByText("Chat"));
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeInTheDocument();
  });
});

it("shows binary and oversized previews and refreshes changed text", async () => {
  const api = mockKushexApi();
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(await screen.findByText("image.bin"));
  expect(await screen.findByText("Binary file — preview unavailable")).toBeInTheDocument();
  await user.click(screen.getByText("large.txt"));
  expect(await screen.findByText("File is too large to preview")).toBeInTheDocument();
  await user.dblClick(screen.getByText("src"));
  await user.click(await screen.findByText("index.ts"));
  expect(await screen.findByLabelText("src/index.ts contents")).toHaveTextContent(
    "export const answer = 42;",
  );
  api.files["src/index.ts"] = {
    path: "src/index.ts",
    kind: "text",
    content: "changed on disk",
    size: 15,
  };
  const viewer = screen.getByRole("region", { name: "src/index.ts viewer" });
  await user.click(within(viewer).getByRole("button", { name: "Refresh file" }));
  await waitFor(() =>
    expect(screen.getByLabelText("src/index.ts contents")).toHaveTextContent("changed on disk"),
  );
});

describe("Workbench routes", () => {
  it("opens the page named by the initial path", async () => {
    render(<KushexPanel initialPath="/settings" />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();

    const user = userEvent.setup();
    const activities = screen.getByRole("navigation", { name: "Activities" });
    await user.click(within(activities).getByRole("button", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });

  it("opens a project's files and a task straight from their URLs", async () => {
    const { unmount } = render(<KushexPanel initialPath="/projects/11111111-1111-4111-8111-111111111111/files" />);
    expect(await screen.findByText("src")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Project one · alpha");
    unmount();

    render(<KushexPanel initialPath="/tasks/t3" />);
    expect(screen.getByRole("tab", { name: "Task title", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start with agent" })).toBeInTheDocument();
  });

  it("keeps the page in the URL in browser mode and falls back to Projects for unknown paths", async () => {
    window.history.replaceState(null, "", "/kushex/nowhere");
    const user = userEvent.setup();
    render(<KushexPanel router="browser" basename="/kushex" />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/kushex/projects");

    await user.click(within(screen.getByRole("navigation", { name: "Activities" })).getByRole("link", { name: "Notes" }));
    expect(window.location.pathname).toBe("/kushex/notes/n1");
    window.history.replaceState(null, "", "/");
  });
});

it("navigates through the handle and reports page changes to the host", async () => {
  const ref = createRef<KushexPanelHandle>();
  const onNavigate = vi.fn();
  render(<KushexPanel ref={ref} onNavigate={onNavigate} />);
  await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith("/projects"));

  act(() => ref.current!.navigate("/notes"));
  expect(screen.getByRole("textbox", { name: "Note text" })).toBeInTheDocument();
  await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith("/notes/n1"));
});
