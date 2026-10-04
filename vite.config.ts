import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Ship the snapshot JSON next to the site so dist/data/latest.json doubles as a public API.
function copySnapshot(): Plugin {
  return {
    name: "copy-snapshot",
    apply: "build",
    closeBundle() {
      const src = resolve(__dirname, "data");
      if (existsSync(src)) cpSync(src, resolve(__dirname, "dist/data"), { recursive: true });
    },
  };
}

// Relative base so the build works from any static host or subpath (GitHub Pages, Vercel, S3).
export default defineConfig({
  base: "./",
  plugins: [react(), copySnapshot()],
  build: { outDir: "dist" },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
} as never);
