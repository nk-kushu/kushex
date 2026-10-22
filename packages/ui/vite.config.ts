import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// Peers and runtime dependencies stay external: the host provides one copy of each.
const external = [...Object.keys(pkg.peerDependencies), ...Object.keys(pkg.dependencies)];
const isExternal = (id: string) => external.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
      cssFileName: "style",
    },
    rollupOptions: { external: isExternal },
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    css: false,
    testTimeout: 15_000,
  },
});
