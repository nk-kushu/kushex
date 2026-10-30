import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KushexPanel } from "../../KushexPanel";
import { mockKushexApi } from "../../test/mockApi";

it("creates a note, saves edits on its own and previews them as markdown", async () => {
  const api = mockKushexApi();
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/notes" />);
  const [, emptyStateButton] = await screen.findAllByRole("button", { name: "New note" });
  await user.click(emptyStateButton!);

  const text = await screen.findByRole("textbox", { name: "Note text" });
  expect(text).toHaveValue("# New note\n\n");
  await user.clear(text);
  await user.type(text, "# FrameworkRuntime{enter}{enter}Orders **startup** and shutdown.");
  expect(screen.queryByRole("region", { name: "Note preview" })).not.toBeInTheDocument();
  await user.click(screen.getByText("Preview"));
  expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Note preview" })).getByText("startup").tagName,
  ).toBe("STRONG");
  expect(screen.getByRole("tab", { name: "FrameworkRuntime" })).toBeInTheDocument();

  await waitFor(
    () => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved"),
    {
      timeout: 3000,
    },
  );
  expect(api.pageNotes[0]).toMatchObject({
    title: "FrameworkRuntime",
    content: "# FrameworkRuntime\n\nOrders **startup** and shutdown.",
    revision: 2,
  });
  expect(await screen.findByRole("menuitem", { name: /FrameworkRuntime/ })).toBeInTheDocument();
});

it("pins, searches and deletes notes", async () => {
  const api = mockKushexApi();
  api.pageNotes.push(
    {
      id: "note-a",
      title: "Workflows",
      content: "# Workflows\n\nVersioned definitions.",
      pinned: false,
      revision: 1,
      createdAt: "2026-10-29T00:00:00.000Z",
      updatedAt: "2026-10-29T00:00:00.000Z",
    },
    {
      id: "note-b",
      title: "Executors",
      content: "# Executors\n\nTyped registrations.",
      pinned: false,
      revision: 1,
      createdAt: "2026-10-29T00:00:01.000Z",
      updatedAt: "2026-10-29T00:00:01.000Z",
    },
  );
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/notes" />);
  // The most recently edited note opens first.
  expect(await screen.findByRole("tab", { name: "Executors" })).toBeInTheDocument();

  await user.click(screen.getByRole("menuitem", { name: /Workflows/ }));
  expect(await screen.findByRole("tab", { name: "Workflows" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Pin note" }));
  await waitFor(() =>
    expect(api.pageNotes.find((note) => note.id === "note-a")?.pinned).toBe(true),
  );
  const list = screen.getByRole("menu", { name: "Notes" });
  await waitFor(() =>
    expect(within(list).getAllByRole("menuitem")[0]).toHaveTextContent("Workflows"),
  );

  await user.type(screen.getByRole("textbox", { name: "Search notes" }), "typed");
  await waitFor(() => expect(within(list).getAllByRole("menuitem")).toHaveLength(1));
  expect(within(list).getByRole("menuitem")).toHaveTextContent("Executors");
  await user.clear(screen.getByRole("textbox", { name: "Search notes" }));

  await user.click(screen.getByRole("button", { name: "Delete note" }));
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.pageNotes.map((note) => note.id)).toEqual(["note-b"]));
  expect(await screen.findByRole("tab", { name: "Executors" })).toBeInTheDocument();
});
