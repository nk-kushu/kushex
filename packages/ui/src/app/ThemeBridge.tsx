import { useTheme, useThemeMode } from "antd-style";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { ANTD_CSS_VAR_PREFIX } from "./theme";

/**
 * Panel root element. antd 6 scopes its CSS variables to each antd component's root,
 * so plain Tailwind wrappers would not see them; this writes the bridged tokens onto
 * the panel root (and sets `kx-dark` for Tailwind's dark variant).
 */
export const ThemeBridge = forwardRef<HTMLDivElement, Readonly<{ className?: string; style?: CSSProperties; children: ReactNode }>>(
  function ThemeBridge({ className, style, children }, ref) {
    const token = useTheme();
    const { isDarkMode } = useThemeMode();
    const p = `--${ANTD_CSS_VAR_PREFIX}`;
    const vars = {
      [`${p}-color-primary`]: token.colorPrimary,
      [`${p}-color-success`]: token.colorSuccess,
      [`${p}-color-warning`]: token.colorWarning,
      [`${p}-color-error`]: token.colorError,
      [`${p}-color-bg-container`]: token.colorBgContainer,
      [`${p}-color-bg-layout`]: token.colorBgLayout,
      [`${p}-color-fill-tertiary`]: token.colorFillTertiary,
      [`${p}-color-border`]: token.colorBorder,
      [`${p}-color-text`]: token.colorText,
      [`${p}-color-text-secondary`]: token.colorTextSecondary,
      [`${p}-border-radius`]: `${token.borderRadius}px`,
      [`${p}-font-family`]: token.fontFamily,
      [`${p}-font-family-code`]: token.fontFamilyCode,
    } as CSSProperties;
    const classes = ["kx-root", isDarkMode ? "kx-dark" : "kx-light", className].filter(Boolean).join(" ");
    return (
      <div
        ref={ref}
        className={classes}
        data-appearance={isDarkMode ? "dark" : "light"}
        style={{ ...vars, color: token.colorText, background: token.colorBgLayout, fontFamily: token.fontFamily, colorScheme: isDarkMode ? "dark" : "light", ...style }}
      >
        {children}
      </div>
    );
  },
);
