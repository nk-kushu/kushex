import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KushexPanel } from "../../KushexPanel";
import { mockKushexApi } from "../../test/mockApi";

it("creates a real project from a chosen workspace and opens its files", async () => {
  const api = mockKushexApi([]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  expect(
    await screen.findByText("No projects yet. Choose a workspace to get started."),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New project" }));
  await user.type(screen.getByLabelText("Project name"), "My codebase");
  await user.click(screen.getByRole("combobox", { name: "Workspace directory" }));
  await user.click(await screen.findByTitle("alpha"));
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("src")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("My codebase · alpha");
  expect(api.projects[0]).toMatchObject({ name: "My codebase", workspace: { path: "alpha" } });
});

it("shows an actionable server failure instead of fixture projects", async () => {
  mockKushexApi([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: "INTERNAL_ERROR", message: "An unexpected error occurred." }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  render(<KushexPanel />);
  expect(await screen.findByText("An unexpected error occurred.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open Project one" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh projects" })).toBeEnabled();
});
