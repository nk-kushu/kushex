import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { KushexPanel } from "./KushexPanel";
import type { KushexPanelHandle } from "./types";

describe("KushexPanel", () => {
  it("starts on the Projects screen", () => {
    render(<KushexPanel />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Activities" })).toBeInTheDocument();
  });

  it("switches color mode through the handle and persists it", async () => {
    const ref = createRef<KushexPanelHandle>();
    render(<KushexPanel ref={ref} colorMode="light" instanceId="p1" />);
    const root = document.querySelector(".kx-root") as HTMLElement;
    expect(root).toHaveClass("kx-light");
    const lightBg = root.style.getPropertyValue("--kx-ant-color-bg-container");

    act(() => ref.current!.setColorMode("dark"));

    await waitFor(() => expect(root).toHaveClass("kx-dark"));
    expect(root.style.getPropertyValue("--kx-ant-color-bg-container")).not.toBe(lightBg);
    expect(JSON.parse(localStorage.getItem("kushex:preferences:p1")!)).toMatchObject({ colorMode: "dark" });
  });

  it("keeps two panels independent", async () => {
    const a = createRef<KushexPanelHandle>();
    render(
      <>
        <KushexPanel ref={a} instanceId="a" colorMode="light" />
        <KushexPanel instanceId="b" colorMode="light" />
      </>,
    );
    act(() => a.current!.setColorMode("dark"));
    const roots = document.querySelectorAll(".kx-root");
    await waitFor(() => expect(roots[0]).toHaveClass("kx-dark"));
    expect(roots[1]).toHaveClass("kx-light");
  });
});
