import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ui = (path: string) => fileURLToPath(new URL(`../../packages/ui/src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Build the panel from source: HMR in dev, one Tailwind pass over the ui sources.
    alias: [
      { find: /^@kushex\/ui$/, replacement: ui("index.ts") },
      { find: /^@kushex\/ui\/preflight\.css$/, replacement: ui("shared/styles/preflight.css") },
    ],
  },
  server: { port: 5173 },
});
