import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockKushexApi } from "../../test/mockApi";
import { KushexPanel } from "../../KushexPanel";

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

  it("opens a diff tab from the chat changes card", async () => {
    const user = userEvent.setup();
    render(<KushexPanel />);
    await user.click(await screen.findByRole("button", { name: "Open Project one" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(screen.getByRole("tab", { name: /Δ file\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
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
