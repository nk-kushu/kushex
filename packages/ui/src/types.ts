import type { CSSProperties } from "react";

/** Public types are self-contained: no internal store types leak to hosts. */
export type ColorMode = "light" | "dark" | "system";

/**
 * How the panel keeps its current page.
 * - "memory": in the panel only; the host URL never changes (default, safe to embed).
 * - "browser": in the URL path, for a page that is all panel. The server must serve the app for every path.
 * - "hash": in the URL hash, when the server cannot do that.
 */
export type RouterMode = "memory" | "browser" | "hash";

export type KushexPanelOptions = Readonly<{
  /** Overrides the stored preference while set; changing it switches the theme live. */
  colorMode?: ColorMode;
  /** Same-origin API prefix. Cross-origin deployments require authentication first. */
  apiBaseUrl?: string;
  /** Identifies a panel instance. Settings are shared by the backend user. Default "default". */
  instanceId?: string;
  /** Where antd and antd-style inject CSS (a ShadowRoot when embedded). Default: document.head. */
  styleContainer?: ShadowRoot | HTMLElement;
  /** Each page has its own route; this picks where the route lives. Read once at mount. Default "memory". */
  router?: RouterMode;
  /** URL prefix the panel's pages live under, e.g. "/kushex". Default "/". */
  basename?: string;
  /** First page in memory mode, e.g. "/settings". Default "/projects". */
  initialPath?: string;
  /** Called with the panel path (without basename) whenever the page changes, e.g. to sync the host URL. */
  onNavigate?: (path: string) => void;
  className?: string;
  style?: CSSProperties;
}>;

/** Imperative handle (React 19 `ref` prop). */
export type KushexPanelHandle = Readonly<{
  setColorMode: (mode: ColorMode) => void;
  /** Go to a panel path, e.g. "/settings" or "/tasks/t1". */
  navigate: (path: string) => void;
}>;
