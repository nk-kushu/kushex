import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const ui = (path: string) => fileURLToPath(new URL(`../ui/src/${path}`, import.meta.url));

/**
 * `vite build` → dist/index.js (ESM, everything bundled, pages as lazy chunks).
 * `vite build --mode iife` → dist/kushex.iife.js for a plain <script> tag.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Bundle the panel from source, so its Tailwind CSS is compiled here as an inline string.
    alias: [
      { find: /^@kushex\/ui$/, replacement: ui("index.ts") },
      { find: /^@kushex\/ui\/style\.css\?inline$/, replacement: `${ui("shared/styles/index.css")}?inline` },
      { find: /^@kushex\/ui\/preflight\.css\?inline$/, replacement: `${ui("shared/styles/preflight.css")}?inline` },
    ],
  },
  // React and antd are bundled; the host page has no `process`.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    emptyOutDir: mode !== "iife",
    sourcemap: true,
    // The panel's own CSS ships inside the JS (injected per mount), not as a file.
    cssCodeSplit: false,
    lib:
      mode === "iife"
        ? { entry: "src/iife.ts", formats: ["iife"], name: "Kushex", fileName: () => "kushex.iife.js" }
        : { entry: "src/index.ts", formats: ["es"], fileName: "index" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["../ui/src/test/setup.ts"],
    // Process CSS so the inline panel styles are real in tests.
    css: { include: [/.+/] },
    testTimeout: 15_000,
  },
}));
