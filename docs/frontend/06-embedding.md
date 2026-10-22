# 06 — Embedding (`packages/embed`)

The panel must run full-page (`apps/standalone`) and inside another application.
`packages/ui` provides the React root; `packages/embed` provides two ways to mount
it.

## Option A — React host

The host already uses React 19:

```tsx
import { KushexPanel } from "@kushex/ui";
import "@kushex/ui/style.css";

<KushexPanel
  apiBaseUrl="https://host.example/kushex-api"
  getAuthToken={() => auth.getToken()}
  router="memory"            // don't fight the host's router
  initialPath="/runs"
  colorMode="system"
  onNavigate={(path) => {/* optional: sync to host URL */}}
/>
```

## Option B — Any host (framework-agnostic)

`@kushex/embed` bundles React, ReactDOM and antd and exposes an imperative API:

```ts
import { mountKushex } from "@kushex/embed";

const handle = mountKushex(document.getElementById("kushex")!, {
  apiBaseUrl: "/kushex-api",
  getAuthToken: () => auth.getToken(),
  shadow: true,              // default: render inside a Shadow DOM
  colorMode: "dark",
});

handle.navigate("/runs/01J...F3");
handle.setColorMode("light");
handle.unmount();
```

As implemented (`packages/embed/src/mountKushex.tsx`), the panel is rendered with
`flushSync`, so `handle.navigate` works as soon as `mountKushex` returns. Panel
CSS (Preflight + Tailwind) is compiled into the bundle as a string and injected
per mount: into the shadow root, or once per document without Preflight when
`shadow: false`. Browsers ignore `@property` inside shadow roots, so Tailwind's
`@property` rules are also copied into the document once. `KushexPanel` takes a
`styleContainer` option and sets both style providers itself.

Original sketch:

```tsx
export function mountKushex(el: HTMLElement, options: MountOptions): KushexHandle {
  const host = options.shadow === false ? el : el.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  host.appendChild(container);

  // Tailwind output is injected into the shadow root as a <style>
  if (host instanceof ShadowRoot) injectStyles(host, tailwindCss);

  const root = createRoot(container);
  root.render(
    <StyleProvider container={host} layer>
      <KushexPanel {...options} router="memory" />
    </StyleProvider>,
  );
  return { navigate, setColorMode, unmount: () => root.unmount() };
}
```

## Isolation checklist

| Risk | Mitigation |
| --- | --- |
| Host CSS leaks into panel / Tailwind Preflight leaks into host | Shadow DOM (default); antd `StyleProvider container={shadowRoot}` and antd-style `StyleProvider container={shadowRoot}` so both CSS-in-JS outputs (antd and Emotion) land inside it |
| Class name collisions | antd `prefixCls="kx"`, Tailwind `prefix(kx)` |
| Popups (Select, Dropdown, Modal) render into `document.body` outside the shadow root | `ConfigProvider getPopupContainer={() => container}` |
| Two panels on one page share state | `makeStore()` per mount; no module-level state |
| Duplicate React in a React host | Option A uses peer deps; Option B is only for non-React hosts |
| Host routing broken | `router: "memory"`; navigation exposed through `onNavigate` / `handle.navigate` |
| Auth tokens | Host supplies `getAuthToken`; the panel never stores tokens |

## Bundle outputs

| Package | Output | Externals |
| --- | --- | --- |
| `@kushex/ui` | ESM + `.d.ts` + `style.css` | `react`, `react-dom`, `antd`, `@ant-design/icons` |
| `@kushex/embed` | ESM (pages as lazy chunks) + `dist/kushex.iife.js` exposing `window.Kushex.mountKushex` | none |

`@kushex/embed` builds the panel from `packages/ui/src` (Vite alias) so the panel
CSS is compiled there as an inline string.
