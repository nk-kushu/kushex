import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginDto } from "@kushex/contracts";
import { KushexPanel } from "../../KushexPanel";
import { exampleAgent, mockKushexApi } from "../../test/mockApi";

const plugin: PluginDto = {
  id: "development",
  name: "Development Agents",
  version: "1.0.0",
  errors: [],
  agents: [
    {
      id: "reviewer",
      name: "Reviewer",
      description: "Review code",
      directory: "sources/review",
      entry: "agent.ts",
    },
  ],
};

it("browses plugins in the embedded panel and opens a contributed agent", async () => {
  mockKushexApi([], [{ ...exampleAgent, plugin: { id: plugin.id, name: plugin.name } }], {}, [
    plugin,
  ]);
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/plugins" />);
  expect(await screen.findByText("Development Agents")).toBeVisible();
  expect(screen.getByText(/Version 1.0.0 · 1 agents/)).toBeVisible();
  await user.click(screen.getByRole("link", { name: "View agents" }));
  expect(await screen.findByText("Review code")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "Open agent" }));
  expect(await screen.findByLabelText("agent.ts in reviewer")).toBeVisible();
  expect(await screen.findByText("Development Agents")).toBeVisible();
});

it("shows invalid packages and leaves their agents unavailable", async () => {
  mockKushexApi([], [], {}, [{ ...plugin, errors: ['Duplicate agent ID "reviewer".'] }]);
  render(<KushexPanel initialPath="/plugins/development" />);
  expect(await screen.findByText('Duplicate agent ID "reviewer".')).toBeVisible();
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Open agent" })).not.toBeInTheDocument();
});
