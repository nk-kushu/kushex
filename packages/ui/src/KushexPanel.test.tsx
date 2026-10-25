import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { KushexPanel } from "./KushexPanel";
import { mockKushexApi } from "./test/mockApi";
import type { KushexPanelHandle } from "./types";

describe("KushexPanel", () => {
  it("starts on the Projects screen", () => {
    render(<KushexPanel />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Activities" })).toBeInTheDocument();
  });

  it("switches color mode through the handle and persists it", async () => {
    const { fetch } = mockKushexApi([]);
    const ref = createRef<KushexPanelHandle>();
    render(<KushexPanel ref={ref} instanceId="p1" />);
    const root = document.querySelector(".kx-root") as HTMLElement;
    await waitFor(() => expect(root).toHaveClass("kx-light"));
    const lightBg = root.style.getPropertyValue("--kx-ant-color-bg-container");

    act(() => ref.current!.setColorMode("dark"));

    await waitFor(() => expect(root).toHaveClass("kx-dark"));
    expect(root.style.getPropertyValue("--kx-ant-color-bg-container")).not.toBe(lightBg);
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([input]) => input instanceof Request && input.method === "PATCH"),
      ).toBe(true),
    );
    expect(localStorage.getItem("kushex:preferences:p1")).toBeNull();
  });

  it("keeps a host color override local and restores the user preference when removed", async () => {
    const { fetch } = mockKushexApi([]);
    const { rerender } = render(<KushexPanel colorMode="dark" />);
    const root = document.querySelector(".kx-root") as HTMLElement;
    await waitFor(() => expect(root).toHaveClass("kx-dark"));
    rerender(<KushexPanel />);
    await waitFor(() => expect(root).toHaveClass("kx-light"));
    expect(
      fetch.mock.calls.every(([input]) => !(input instanceof Request) || input.method !== "PATCH"),
    ).toBe(true);
  });

  it("keeps two panels independent", async () => {
    const a = createRef<KushexPanelHandle>();
    render(
      <>
        <KushexPanel ref={a} instanceId="a" />
        <KushexPanel instanceId="b" colorMode="light" />
      </>,
    );
    act(() => a.current!.setColorMode("dark"));
    const roots = document.querySelectorAll(".kx-root");
    await waitFor(() => expect(roots[0]).toHaveClass("kx-dark"));
    expect(roots[1]).toHaveClass("kx-light");
  });
});
