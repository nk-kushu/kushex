# Kushex

Harness panel for [kushibot](../kushibot). Currently a single page showing the
Kushex title. Design docs for the full panel: [docs/](docs/README.md).

```sh
pnpm install
pnpm dev              # standalone panel on :5173
pnpm test             # vitest in every package
pnpm typecheck && pnpm lint
pnpm build            # @kushex/ui (ESM + style.css + .d.ts), @kushex/embed (ESM + IIFE), standalone
```

| Package | What |
| --- | --- |
| `packages/ui` | `<KushexPanel />`: theme, store, the title page |
| `packages/embed` | `mountKushex(el, options)` for non-React hosts (Shadow DOM) |
| `apps/standalone` | Full-page Vite app |
