import {
  createContext,
  useContext,
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

/** Whether pages have URLs of their own (browser and hash routers), so links can open new tabs. */
const PageUrlsContext = createContext(false);
export const usePageUrls = () => useContext(PageUrlsContext);

type PanelRouterProps = Readonly<{
  mode?: RouterMode;
  basename?: string;
  initialPath?: string;
  children: ReactNode;
}>;

/** The router is fixed at mount; changing its options later would drop the panel's history. */
export function PanelRouter({ mode = "memory", basename, initialPath, children }: PanelRouterProps) {
  const [initial] = useState({ mode, basename, initialPath });
  return (
    <PageUrlsContext value={initial.mode !== "memory"}>
      <ModeRouter {...initial}>{children}</ModeRouter>
    </PageUrlsContext>
  );
}

/** The router for one mode; its options are the ones frozen at mount. */
function ModeRouter({ mode, basename, initialPath, children }: PanelRouterProps) {
  switch (mode) {
    case "browser":
      return <BrowserRouter basename={basename}>{children}</BrowserRouter>;
    case "hash":
      return <HashRouter basename={basename}>{children}</HashRouter>;
    default:
      return (
        <MemoryRouter basename={basename} initialEntries={[withBase(basename, initialPath)]}>
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
