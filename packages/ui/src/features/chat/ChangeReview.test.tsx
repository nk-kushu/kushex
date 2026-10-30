import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EditorFontSizeContext } from "../../shared/lib/editorFontSize";
import { ChangeReview } from "./ChangeReview";

it("shows the proposed file versions and delegates acceptance", async () => {
  const apply = vi.fn();
  const user = userEvent.setup();
  render(
    <ChangeReview
      open
      applying={false}
      applied={false}
      changes={[{ path: "src/a.ts", before: "old", after: "new" }]}
      onClose={() => {}}
      onApply={apply}
    />,
  );
  expect(await screen.findByLabelText("Original")).toHaveTextContent("old");
  expect(screen.getByLabelText("Proposed")).toHaveTextContent("new");
  await user.click(screen.getByRole("button", { name: "Accept and apply" }));
  expect(apply).toHaveBeenCalledOnce();
});

it("shows the diff at the panel's editor font size", async () => {
  render(
    <EditorFontSizeContext value={20}>
      <ChangeReview
        open
        applying={false}
        applied={false}
        changes={[{ path: "src/a.ts", before: "old", after: "new" }]}
        onClose={() => {}}
        onApply={() => {}}
      />
    </EditorFontSizeContext>,
  );
  expect(await screen.findByTestId("diff-editor")).toHaveAttribute("data-font-size", "20");
});
