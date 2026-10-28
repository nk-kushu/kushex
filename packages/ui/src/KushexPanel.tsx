import { StyleProvider as CssInJsStyleProvider } from "@ant-design/cssinjs";
import { App as AntApp, ConfigProvider } from "antd";
import { StyleProvider, ThemeProvider } from "antd-style";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Provider } from "react-redux";
import { useAppSelector } from "./app/hooks";
import { makeStore } from "./app/store";
import { RunTabSync } from "./features/runs/RunTabSync";
import { getAntdTheme } from "./app/theme";
import { NavigationBridge, PanelRouter, type NavigateTo } from "./app/PanelRouter";
import { ThemeBridge } from "./app/ThemeBridge";
import { Workbench } from "./features/workbench/Workbench";
import {
  colorModeChanged,
  settingsRequested,
  selectColorMode,
  selectDensity,
  toThemeMode,
} from "./features/settings/settingsSlice";
import type { KushexPanelHandle, KushexPanelOptions } from "./types";

type KushexPanelProps = KushexPanelOptions & Readonly<{ ref?: Ref<KushexPanelHandle> }>;

/**
 * The Kushex panel. Store and theme are created per mounted instance, so several
 * panels (or tests) on one page never share state.
 */
export function KushexPanel({
  instanceId = "default",
  apiBaseUrl,
  colorMode,
  router,
  basename,
  initialPath,
  onNavigate,
  ref,
  ...rest
}: KushexPanelProps) {
  const [store] = useState(() => {
    return makeStore({
      instanceId,
      apiBaseUrl,
    });
  });

  useEffect(() => {
    store.dispatch(settingsRequested());
  }, [store]);

  useEffect(
    () => new RunTabSync(store, { instanceId, apiBaseUrl }).connect(),
    [store, instanceId, apiBaseUrl],
  );

  const navigateRef = useRef<NavigateTo>(null);
  useImperativeHandle(
    ref,
    () => ({
      setColorMode: (mode) => store.dispatch(colorModeChanged(mode)),
      navigate: (path) => navigateRef.current?.(path),
    }),
    [store],
  );

  return (
    <Provider store={store}>
      <ThemedPanel {...rest} colorMode={colorMode}>
        <PanelRouter mode={router} basename={basename} initialPath={initialPath}>
          <NavigationBridge navigateRef={navigateRef} onNavigate={onNavigate} />
          <Workbench />
        </PanelRouter>
      </ThemedPanel>
    </Provider>
  );
}

function ThemedPanel({
  colorMode: hostColorMode,
  styleContainer,
  className,
  style,
  children,
}: Pick<KushexPanelProps, "styleContainer" | "className" | "style" | "colorMode"> & {
  children: ReactNode;
}) {
  const colorMode = useAppSelector(selectColorMode);
  const density = useAppSelector(selectDensity);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <StyleProvider prefix="kx" container={styleContainer}>
      {/* antd's generated CSS goes into `@layer antd` (after Tailwind base, before utilities). */}
      <CssInJsStyleProvider layer container={styleContainer}>
        <ThemeProvider
          themeMode={toThemeMode(hostColorMode ?? colorMode)}
          theme={getAntdTheme}
          prefixCls="kx"
        >
          <ThemeBridge ref={rootRef} className={className} style={style}>
            <ConfigProvider
              iconPrefixCls="kx-icon"
              componentSize={density === "compact" ? "small" : "middle"}
              getPopupContainer={() => rootRef.current ?? document.body}
            >
              <AntApp className="kx:h-full">{children}</AntApp>
            </ConfigProvider>
          </ThemeBridge>
        </ThemeProvider>
      </CssInJsStyleProvider>
    </StyleProvider>
  );
}
