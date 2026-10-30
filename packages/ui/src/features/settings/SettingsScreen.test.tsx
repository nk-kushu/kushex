import type { UserSettingsDto } from "@kushex/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KushexPanel } from "../../KushexPanel";
import TextFileViewer from "../files/TextFileViewer";
import { EditorFontSizeContext } from "../../shared/lib/editorFontSize";

const savedFontSize = async () => {
  const response = await fetch(new Request(new URL("/settings", location.href)));
  return ((await response.json()) as UserSettingsDto).editorFontSize;
};

async function openEditorSection() {
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/settings" />);
  await user.click(screen.getByRole("menuitem", { name: "Editor" }));
  return { user, input: screen.getByLabelText("Font size") };
}

describe("Editor settings", () => {
  it("saves a changed font size", async () => {
    const { user, input } = await openEditorSection();
    await waitFor(() => expect(input).toHaveValue("13"));
    await user.clear(input);
    await user.type(input, "18");
    await user.tab();
    await waitFor(async () => expect(await savedFontSize()).toBe(18));
  });

  it("saves a changed note font size", async () => {
    await openEditorSection();
    const user = userEvent.setup();
    const input = screen.getByLabelText("Note font size");
    await waitFor(() => expect(input).toHaveValue("13"));
    await user.clear(input);
    await user.type(input, "20");
    await user.tab();
    await waitFor(async () => {
      const response = await fetch(new Request(new URL("/settings", location.href)));
      expect(((await response.json()) as UserSettingsDto).noteFontSize).toBe(20);
    });
  });

  it("clamps a size outside the supported range", async () => {
    const { user, input } = await openEditorSection();
    await waitFor(() => expect(input).toHaveValue("13"));
    await user.clear(input);
    await user.type(input, "99");
    await user.tab();
    await waitFor(() => expect(input).toHaveValue("28"));
    await waitFor(async () => expect(await savedFontSize()).toBe(28));
  });
});

it("shows code at the panel's editor font size", () => {
  render(
    <EditorFontSizeContext value={20}>
      <TextFileViewer path="src/a.ts" content="code" />
    </EditorFontSizeContext>,
  );
  expect(screen.getByLabelText("src/a.ts contents")).toHaveAttribute("data-font-size", "20");
});
