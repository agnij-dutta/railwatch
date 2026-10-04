import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Ship the snapshot JSON next to the site so dist/data/latest.json doubles as a public API.
function copySnapshot(): Plugin {
  return {
    name: "copy-snapshot",
    apply: "build",
    closeBundle() {
      const src = resolve(import.meta.dirname, "data");
      if (existsSync(src)) cpSync(src, resolve(import.meta.dirname, "dist/data"), { recursive: true });
    },
  };
}

// Relative base so the build works from any static host or subpath (GitHub Pages, Vercel, S3).
export default defineConfig({
  base: "./",
  plugins: [react(), copySnapshot()],
  build: { outDir: "dist" },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
