import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Markdown } from "./Markdown";

it("renders GitHub-flavoured markdown with scrolling tables and new-tab links", () => {
  const { container } = render(
    <Markdown
      text={
        "# Title\n\n**bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[docs](https://example.com)"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(screen.getByText("code").tagName).toBe("CODE");
  expect(container.querySelector(".kx-markdown-table > table")).not.toBeNull();
  expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("target", "_blank");
});

it("keeps typed line breaks when asked, but not inside code blocks", () => {
  const { container } = render(
    <Markdown breaks text={"first line\nsecond line\n\n```\nx\ny\n```"} />,
  );
  expect(container.querySelectorAll("p br")).toHaveLength(1);
  expect(container.querySelector("pre code")?.textContent).toBe("x\ny\n");
});

it("does not run raw HTML", () => {
  const { container } = render(<Markdown text={'<img src="x" onerror="alert(1)">'} />);
  expect(container.querySelector("img")).toBeNull();
});
