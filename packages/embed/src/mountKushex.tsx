import { KushexPanel, type ColorMode, type KushexPanelHandle, type KushexPanelOptions } from "@kushex/ui";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { injectStyles } from "./styles";

export type MountOptions = Omit<KushexPanelOptions, "styleContainer"> &
  Readonly<{
    /** Render inside a Shadow DOM so host CSS and panel CSS never meet. Default true. */
    shadow?: boolean;
  }>;

export type KushexHandle = Readonly<{
  setColorMode: (mode: ColorMode) => void;
  unmount: () => void;
}>;

/**
 * Mount the Kushex panel into any element. Each call gets its own React root and store,
 * so several panels on one page are independent.
 */
export function mountKushex(el: HTMLElement, options: MountOptions): KushexHandle {
  const { shadow = true, ...panelOptions } = options;
  const host: ShadowRoot | HTMLElement = shadow ? (el.shadowRoot ?? el.attachShadow({ mode: "open" })) : el;
  const container = el.ownerDocument.createElement("div");
  container.dataset.kushex = "";
  container.style.height = "100%";
  host.appendChild(container);
  const removeStyles = injectStyles(host);

  const ref = createRef<KushexPanelHandle>();
  const root = createRoot(container);
  // Synchronous first render, so the handle works as soon as mountKushex returns.
  flushSync(() => {
    root.render(
      <KushexPanel
        {...panelOptions}
        ref={ref}
        // antd and antd-style inject their CSS-in-JS into the shadow root too.
        styleContainer={shadow ? (host as ShadowRoot) : undefined}
        style={{ height: "100%", ...panelOptions.style }}
      />,
    );
  });

  let mounted = true;
  return {
    setColorMode: (mode) => ref.current?.setColorMode(mode),
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      root.unmount();
      container.remove();
      removeStyles();
    },
  };
}
