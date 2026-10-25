import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BrowserRouter, HashRouter, MemoryRouter, useLocation, useNavigate } from "react-router";
import type { RouterMode } from "../types";

export type NavigateTo = (path: string) => void;

type PanelRouterProps = Readonly<{
  mode?: RouterMode;
  basename?: string;
  initialPath?: string;
  children: ReactNode;
}>;

/** The router is fixed at mount; changing its options later would drop the panel's history. */
export function PanelRouter({ mode = "memory", basename, initialPath, children }: PanelRouterProps) {
  const [initial] = useState({ mode, basename, initialPath });
  switch (initial.mode) {
    case "browser":
      return <BrowserRouter basename={initial.basename}>{children}</BrowserRouter>;
    case "hash":
      return <HashRouter basename={initial.basename}>{children}</HashRouter>;
    case "memory":
      return (
        <MemoryRouter
          basename={initial.basename}
          initialEntries={[withBase(initial.basename, initial.initialPath)]}
        >
          {children}
        </MemoryRouter>
      );
  }
}

/** MemoryRouter entries are full paths, so a basename must prefix the initial one. */
function withBase(basename = "/", path = "/projects") {
  return `${basename.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Connects the router to the host: `handle.navigate` in, `onNavigate` out. */
export function NavigationBridge({
  navigateRef,
  onNavigate,
}: Readonly<{ navigateRef: RefObject<NavigateTo | null>; onNavigate?: (path: string) => void }>) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  // A layout effect, so the handle works as soon as a synchronous mount returns.
  useLayoutEffect(() => {
    navigateRef.current = (path) => void navigate(path);
    return () => {
      navigateRef.current = null;
    };
  }, [navigate, navigateRef]);
  const report = useEffectEvent((path: string) => onNavigate?.(path));
  useEffect(() => report(`${pathname}${search}${hash}`), [pathname, search, hash]);
  return null;
}
