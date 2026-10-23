import { mockKushexApi } from "./mockApi";
import "@testing-library/jest-dom/vitest";
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
