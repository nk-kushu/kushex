# 07 — Testing and quality

## Test layers

| Layer | Tool | What |
| --- | --- | --- |
| Unit | Vitest | slices (reducer + selectors), formatters, lifecycle → allowed-actions mapping |
| Component | Vitest + Testing Library + jsdom | screens rendered with a real store; API mocked with MSW |
| API contract | Vitest | RTK Query endpoints against MSW handlers built from `packages/server` DTO types |
| End-to-end | Playwright | standalone app against `packages/server` with a disposable SQLite binding |

## Rendering with providers

```tsx
// test/renderWithProviders.tsx
export function renderWithProviders(ui: React.ReactElement, opts: { preloadedState?: Partial<RootState>; path?: string } = {}) {
  const store = makeStore({ apiBaseUrl: "http://test/api", preloadedState: opts.preloadedState });
  const user = userEvent.setup();
  const result = render(
    <Provider store={store}>
      <ConfigProvider theme={lightTheme} prefixCls="kx">
        <AntApp>
          <MemoryRouter initialEntries={[opts.path ?? "/"]}>{ui}</MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </Provider>,
  );
  return { store, user, ...result };
}
```

Query by role and accessible name (`getByRole("button", { name: "Stop" })`), not
by antd class names — those include the `kx` prefix and change between versions.

## Must-have scenarios

- Run list filters by status and the URL reflects it.
- A lifecycle SSE event for the open run refreshes its status tag.
- Stop: confirm → pending → receipt → status updates; a `409` shows the conflict
  message; retry reuses the same `commandId`.
- Approval flow cannot be confirmed without the review report loaded.
- Dark mode: toggling switches both antd components and Tailwind utilities.
- Two `mountKushex` instances on one page keep independent state.

## Quality gates (CI)

- `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` on every PR.
- Bundle budget for `@kushex/ui` initial chunk (excluding antd/react peers):
  ≤ 150 kB gzip; screens are lazy chunks.
- Accessibility: `eslint-plugin-jsx-a11y`, plus `@axe-core/playwright` on the
  main screens in both color modes.
- Visual check of light/dark for the shell and run detail via Playwright
  screenshots.
