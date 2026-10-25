import { theme, type ThemeConfig } from "antd";
import type { GetAntdThemeConfig } from "antd-style";

/** antd CSS variables are `--kx-ant-*`; `--kx-*` belongs to Tailwind (prefix "kx"). */
export const ANTD_CSS_VAR_PREFIX = "kx-ant";

const shared: ThemeConfig["token"] = {
  colorPrimary: "#fa8c16",
  // Square corners everywhere; the size variants are pinned so none derive a radius.
  borderRadius: 0,
  borderRadiusXS: 0,
  borderRadiusSM: 0,
  borderRadiusLG: 0,
  borderRadiusOuter: 0,
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/**
 * Theme without an algorithm: antd-style's ThemeProvider prepends the light or dark
 * algorithm for the resolved appearance, so setting one here would apply it twice.
 */
export const getAntdTheme: GetAntdThemeConfig = (appearance) => ({
  token: shared,
  cssVar: { prefix: ANTD_CSS_VAR_PREFIX, key: `kushex-${appearance}` },
});

/** Complete themes for a bare antd ConfigProvider (tests, tooling). */
export const lightTheme: ThemeConfig = {
  ...getAntdTheme("light"),
  algorithm: theme.defaultAlgorithm,
};

export const darkTheme: ThemeConfig = {
  ...getAntdTheme("dark"),
  algorithm: theme.darkAlgorithm,
};
