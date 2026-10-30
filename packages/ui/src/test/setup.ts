import { mockKushexApi } from "./mockApi";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** Evaluates min-/max-width media queries against window.innerWidth (jsdom has no layout). */
function matchesWidth(query: string): boolean {
  const min = /min-width:\s*([\d.]+)px/.exec(query);
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  if (!min && !max) return false;
  return (
    (!min || window.innerWidth >= Number(min[1])) && (!max || window.innerWidth <= Number(max[1]))
  );
}

// jsdom gaps that antd relies on.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: matchesWidth(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Monaco needs real layout and web workers; render its value as plain text instead,
// or as a textarea when the editor accepts edits.
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    original,
    modified,
    options,
  }: {
    original: string;
    modified: string;
    options?: { fontSize?: number };
  }) =>
    createElement(
      "div",
      { "data-testid": "diff-editor", "data-font-size": options?.fontSize },
      createElement("pre", { "aria-label": "Original" }, original),
      createElement("pre", { "aria-label": "Proposed" }, modified),
    ),
  default: ({
    value,
    options,
    onChange,
  }: {
    value?: string;
    options?: { ariaLabel?: string; readOnly?: boolean; fontSize?: number };
    onChange?: (value: string) => void;
  }) =>
    options?.readOnly === false
      ? createElement("textarea", {
          "aria-label": options.ariaLabel,
          "data-font-size": options.fontSize,
          value,
          onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
        })
      : createElement(
          "pre",
          { "aria-label": options?.ariaLabel, "data-font-size": options?.fontSize },
          value,
        ),
}));

beforeEach(() => {
  mockKushexApi([]);
  localStorage.clear();
  window.innerWidth = 1280;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
