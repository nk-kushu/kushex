import { waitFor, within } from "@testing-library/dom";
import { mountKushex, type KushexHandle } from "./mountKushex";

const handles: KushexHandle[] = [];

function mount(options: Parameters<typeof mountKushex>[1] = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const handle = mountKushex(el, options);
  handles.push(handle);
  return { el, handle };
}

const shadowOf = (el: HTMLElement) => el.shadowRoot as unknown as HTMLElement;

afterEach(() => {
  handles.splice(0).forEach((handle) => handle.unmount());
  document.body.innerHTML = "";
});

describe("mountKushex", () => {
  it("renders the title inside a shadow root with its styles", () => {
    const { el } = mount();
    expect(el.shadowRoot!.querySelector("style[data-kushex]")?.textContent).toContain("kx\\:flex");
    expect(within(shadowOf(el)).getByRole("heading", { name: "Kushex" })).toBeInTheDocument();
    expect(document.body.querySelector("h1")).toBeNull();
  });

  it("keeps two instances independent", async () => {
    const a = mount({ instanceId: "a", colorMode: "light" });
    const b = mount({ instanceId: "b", colorMode: "light" });
    const rootOf = (el: HTMLElement) => el.shadowRoot!.querySelector(".kx-root")!;

    a.handle.setColorMode("dark");

    await waitFor(() => expect(rootOf(a.el)).toHaveClass("kx-dark"));
    expect(rootOf(b.el)).toHaveClass("kx-light");
  });

  it("injects shared document styles without preflight when shadow is off, and cleans up", () => {
    const first = mount({ shadow: false });
    const second = mount({ shadow: false });
    expect(document.getElementById("kushex-styles")).not.toBeNull();
    first.handle.unmount();
    expect(document.getElementById("kushex-styles")).not.toBeNull();
    second.handle.unmount();
    expect(document.getElementById("kushex-styles")).toBeNull();
    expect(first.el.childElementCount).toBe(0);
  });
});
