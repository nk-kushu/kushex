import { StyleProvider as CssInJsStyleProvider } from "@ant-design/cssinjs";
import { App as AntApp, ConfigProvider } from "antd";
import { StyleProvider, ThemeProvider } from "antd-style";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Provider } from "react-redux";
import { useAppSelector } from "./app/hooks";
import { loadPreferences } from "./app/preferences";
import { makeStore } from "./app/store";
import { getAntdTheme } from "./app/theme";
import { ThemeBridge } from "./app/ThemeBridge";
import { Workbench } from "./features/workbench/Workbench";
import { colorModeChanged, selectColorMode, selectDensity, toThemeMode } from "./features/settings/settingsSlice";
import type { KushexPanelHandle, KushexPanelOptions } from "./types";

type KushexPanelProps = KushexPanelOptions & Readonly<{ ref?: Ref<KushexPanelHandle> }>;

/**
 * The Kushex panel. Store and theme are created per mounted instance, so several
 * panels (or tests) on one page never share state.
 */
export function KushexPanel({ instanceId = "default", colorMode, ref, ...rest }: KushexPanelProps) {
  const [store] = useState(() => {
    const settings = loadPreferences(instanceId);
    return makeStore({ instanceId, preloadedState: { settings: colorMode ? { ...settings, colorMode } : settings } });
  });

  // Host-controlled color mode wins over the stored preference while it is set.
  useEffect(() => {
    if (colorMode) store.dispatch(colorModeChanged(colorMode));
  }, [colorMode, store]);

  useImperativeHandle(ref, () => ({ setColorMode: (mode) => store.dispatch(colorModeChanged(mode)) }), [store]);

  return (
    <Provider store={store}>
      <ThemedPanel {...rest}>
        <Workbench />
      </ThemedPanel>
    </Provider>
  );
}

function ThemedPanel({
  styleContainer,
  className,
  style,
  children,
}: Pick<KushexPanelProps, "styleContainer" | "className" | "style"> & { children: ReactNode }) {
  const colorMode = useAppSelector(selectColorMode);
  const density = useAppSelector(selectDensity);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <StyleProvider prefix="kx" container={styleContainer}>
      {/* antd's generated CSS goes into `@layer antd` (after Tailwind base, before utilities). */}
      <CssInJsStyleProvider layer container={styleContainer}>
        <ThemeProvider themeMode={toThemeMode(colorMode)} theme={getAntdTheme} prefixCls="kx">
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
