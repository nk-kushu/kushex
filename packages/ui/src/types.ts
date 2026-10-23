import type { CSSProperties } from "react";

/** Public types are self-contained: no internal store types leak to hosts. */
export type ColorMode = "light" | "dark" | "system";

export type KushexPanelOptions = Readonly<{
  /** Overrides the stored preference while set; changing it switches the theme live. */
  colorMode?: ColorMode;
  /** Same-origin API prefix. Cross-origin deployments require authentication first. */
  apiBaseUrl?: string;
  /** Keys persisted preferences; give each panel on a page its own id. Default "default". */
  instanceId?: string;
  /** Where antd and antd-style inject CSS (a ShadowRoot when embedded). Default: document.head. */
  styleContainer?: ShadowRoot | HTMLElement;
  className?: string;
  style?: CSSProperties;
}>;

/** Imperative handle (React 19 `ref` prop). */
export type KushexPanelHandle = Readonly<{
  setColorMode: (mode: ColorMode) => void;
}>;
