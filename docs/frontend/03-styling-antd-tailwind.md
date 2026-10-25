# 03 — Styling: Ant Design 6 + antd-style + Tailwind CSS 4

Ant Design generates its styles at runtime (CSS-in-JS, CSS variables by default
in v6). [`antd-style`](https://ant-design.github.io/antd-style/) is the Ant Design
team's CSS-in-JS library (built on Emotion) for writing your own styles with the
antd theme tokens. Tailwind 4 is a CSS-first build-time tool built on native
cascade layers. They work together as long as three things are set up: **layer
order**, **one token source**, and **a clear split of responsibilities**.

## 1. Who does what

| Use antd for | Use antd-style for | Use Tailwind for |
| --- | --- | --- |
| Any interactive component (Button, Table, Form, Select, Modal, Drawer, Tabs, Menu) | Custom components with real styling: `TraceBar`, `UsageMeter`, `ArtifactViewer`, `JsonViewer` | Page and section layout: `flex`, `grid`, `gap-*`, `p-*`, `min-h-0`, `overflow-auto` |
| Data display (Descriptions, Statistic, Timeline, Steps, Tag, Badge, Tooltip) | Styles that compute from tokens (`token.colorPrimaryBg`, `token.paddingSM * 2`) or depend on props/state | Spacing around antd components |
| Feedback (message, notification, Result, Skeleton, Spin, Alert) | Nested parts, pseudo-states, keyframes that would be a wall of utility classes | Responsive tweaks (`md:`, `lg:`) |
| Typography (`Typography.Title/Text/Paragraph`) | Passing styles into antd `classNames`/`styles` props of a component | Truncation and text helpers around antd |

Don't restyle antd components with Tailwind classes or antd-style rules on their
internals (`.kx-btn` overrides, `!important`). Change the antd theme token or
component token instead.

If a component's styling is more than ~6 utility classes or needs a token
Tailwind doesn't map, move it to `createStyles`. Don't mix both on the same
element.

## 1a. antd-style usage

Version: `antd-style@^4` (peer `antd >=6`, `react >=18`).

```tsx
// features/runs/components/TraceBar.styles.ts
import { createStyles } from "antd-style";

export const useStyles = createStyles(({ token, css, cx }, props: { failed: boolean }) => ({
  track: css`
    position: relative;
    height: 8px;
    border-radius: ${token.borderRadiusSM}px;
    background: ${token.colorFillTertiary};
  `,
  bar: cx(
    css`
      position: absolute;
      inset-block: 0;
      border-radius: inherit;
      background: ${props.failed ? token.colorError : token.colorPrimary};
      transition: width ${token.motionDurationMid};
    `,
  ),
}));
```

```tsx
// TraceBar.tsx
export function TraceBar({ startPct, widthPct, failed }: TraceBarProps) {
  const { styles } = useStyles({ failed });
  return (
    <div className={styles.track}>
      <div className={styles.bar} style={{ left: `${startPct}%`, width: `${widthPct}%` }} />
    </div>
  );
}
```

Conventions:

- Styles live next to the component in `Component.styles.ts`, exporting
  `useStyles`.
- Use `token` for every color, size, radius and motion value.
- Use `responsive` from `createStyles` (`responsive.mobile`, `responsive.md`)
  instead of hand-written media queries.
- Theme mode (light/dark/system) is owned by antd-style's `ThemeProvider`
  (`appearance`, `themeMode`), driven from `settingsSlice.colorMode` — see §4.
- `useTheme()` from antd-style replaces `theme.useToken()` in our code.

Provider setup in `KushexPanel.tsx` (replaces the bare `ConfigProvider`):

```tsx
import { ThemeProvider, StyleProvider } from "antd-style";

<StyleProvider prefix="kx" container={styleContainer}>
  <ThemeProvider
    themeMode={colorMode}                  // "light" | "dark" | "auto"
    theme={(appearance) => (appearance === "dark" ? darkTheme : lightTheme)}
    prefixCls="kx"
  >
    <AntApp>{children}</AntApp>
  </ThemeProvider>
</StyleProvider>
```

antd-style's `ThemeProvider` wraps antd's `ConfigProvider`, so `theme`,
`prefixCls` and `getPopupContainer` still reach antd components. Check the
antd-style 4 docs for the exact prop names when installing.

### Cascade note

Emotion emits **unlayered** CSS. Unlayered rules beat every `@layer`, including
Tailwind `utilities`. That is acceptable because of the split above (an element
gets its look from antd-style *or* Tailwind, never both). If a Tailwind utility
must override an antd-style class, the antd-style rule is in the wrong place —
move the property to one side.

## 2. Layer order

Tailwind 4's Preflight (CSS reset) lives in `@layer base`. Put antd's styles in
their own layer **after** `base` so the reset never wins over antd, and **before**
`utilities` so a Tailwind utility on a wrapper still applies.

`packages/ui/src/shared/styles/index.css`:

```css
@layer theme, base, antd, components, utilities;

@import "tailwindcss/theme.css" layer(theme) prefix(kx);
@import "tailwindcss/utilities.css" layer(utilities) prefix(kx);
@source "../..";

/* Bridge: expose antd tokens to Tailwind (values are set at runtime, see §3) */
@theme inline {
  --color-primary: var(--kx-ant-color-primary);
  --color-success: var(--kx-ant-color-success);
  --color-warning: var(--kx-ant-color-warning);
  --color-error: var(--kx-ant-color-error);
  --color-surface: var(--kx-ant-color-bg-container);
  --color-surface-muted: var(--kx-ant-color-bg-layout);
  --color-fill: var(--kx-ant-color-fill-tertiary);
  --color-border: var(--kx-ant-color-border);
  --color-text: var(--kx-ant-color-text);
  --color-text-muted: var(--kx-ant-color-text-secondary);
  --radius-kx: var(--kx-ant-border-radius);
  --font-sans: var(--kx-ant-font-family);
  --font-mono: var(--kx-ant-font-family-code);
}

/* Dark mode follows the antd algorithm, toggled by a class on the panel root */
@custom-variant dark (&:where(.kx-dark, .kx-dark *));
```

**Preflight is not in `index.css`.** The library's `style.css` would otherwise
reset the whole host page in a React host (Option A in [06](06-embedding.md)).
It lives in `shared/styles/preflight.css`; the standalone app imports it
globally and the embed injects it into its shadow root only. Without Preflight,
`kx:border` needs `kx:border-solid`.

antd 6 does not expose the layer option on `ConfigProvider`, so antd's CSS goes
into `@layer antd` through `@ant-design/cssinjs`. As built in `KushexPanel.tsx`:

```tsx
<StyleProvider prefix="kx" container={styleContainer}>          {/* antd-style (Emotion) */}
  <CssInJsStyleProvider layer container={styleContainer}>       {/* @ant-design/cssinjs */}
    <ThemeProvider themeMode={toThemeMode(colorMode)} theme={getAntdTheme} prefixCls="kx">
      <ThemeBridge ref={rootRef}>                                {/* panel root, see §3 */}
        <ConfigProvider iconPrefixCls="kx-icon" componentSize={…} getPopupContainer={() => rootRef.current}>
          <AntApp>{children}</AntApp>
        </ConfigProvider>
      </ThemeBridge>
    </ThemeProvider>
  </CssInJsStyleProvider>
</StyleProvider>
```

antd-style's `StyleProvider` renders its own cssinjs provider without `layer`, so
ours is nested inside it. Popups render into the panel root, so they inherit the
bridged variables and stay inside a shadow root.

## 3. One token source

The antd `ThemeConfig` in `app/theme.ts` is the single source of truth:

```ts
import { theme, type ThemeConfig } from "antd";

const shared: ThemeConfig["token"] = {
  colorPrimary: "#fa8c16",
  borderRadius: 8,
  fontFamily: "Inter, system-ui, sans-serif",
};

/** No algorithm: antd-style's ThemeProvider prepends light/dark itself. */
export const getAntdTheme: GetAntdThemeConfig = (appearance) => ({
  token: shared,
  cssVar: { prefix: "kx-ant", key: `kushex-${appearance}` },
});

// lightTheme / darkTheme add the algorithm, for a bare ConfigProvider (tests).
```

**Prefix `kx-ant`, not `kx`.** With Tailwind's `prefix(kx)`, Tailwind's own
variables are `--kx-*` (`--kx-color-primary` is what `--color-primary` becomes),
so antd sharing `--kx-` would make the bridge reference itself. antd's variables
are therefore `--kx-ant-color-primary` etc.

**ThemeBridge is required, not a fallback.** antd 6 scopes its CSS variables to
a class on each antd component's root, so a plain Tailwind `<div>` outside an
antd component would not see them. `app/ThemeBridge.tsx` is the panel root
element: it reads the tokens with antd-style's `useTheme()` and writes the
bridged `--kx-ant-*` variables onto itself, together with the `kx-dark` class
(§4). `kx:bg-surface`, `kx:text-text-muted`, `kx:border-border`,
`kx:text-primary` and `kx:rounded-kx` then follow the active antd theme
everywhere in the panel, with no duplicated hex values.

## 4. Dark mode

- `settingsSlice.colorMode`: `"light" | "dark" | "system"`, passed to antd-style
  `ThemeProvider` as `themeMode` (`"system"` → `"auto"`).
- antd-style resolves `"auto"` through `prefers-color-scheme` and gives the
  resolved `appearance` to the `theme` function, which picks `lightTheme` or
  `darkTheme`.
- `ThemeBridge` reads `useThemeMode().isDarkMode` and sets class `kx-dark` (or
  `kx-light`) on the panel root. Tailwind `dark:` utilities key off that
  class, not the OS, so an embedded panel can differ from its host page.

## 5. Avoiding collisions with host apps

Because the panel can be embedded:

- antd `prefixCls="kx"` → classes are `.kx-btn`, not `.ant-btn`, so a host
  using its own antd version does not clash.
- Tailwind with a prefix: `@import "tailwindcss" prefix(kx);` → utilities are
  written `kx:flex kx:gap-4`. Decide this once before writing components. Default
  for this project: **use the prefix** in `packages/ui`, since it is a library.
- Preflight only applies inside the panel. In the embed build, scope it by
  rendering into a Shadow DOM (see [06](06-embedding.md)); in the standalone app
  it can stay global.

## 6. Status colors

Lifecycle statuses from kushibot map to antd semantic colors in one place,
`shared/components/StatusTag.tsx`:

| `LifecycleStatus` | antd `Tag` color / `Badge` status |
| --- | --- |
| `created`, `queued` | `default` |
| `active`, `recovering` | `processing` |
| `retry-wait`, `paused`, `stopping` | `warning` |
| `waiting-for-approval` | `gold` + icon, always visually prominent |
| `interrupted` | `orange` |
| `completed` | `success` |
| `failed` | `error` |
| `stopped`, `cancelled` | `default` with strikethrough-free muted text |

Status is never color-only: the tag always carries the status text.
