import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import stripMockHoverMotion from "./postcss-strip-mock-hover-motion.mjs";

// The renderer directory is its own Vite root: `main.js` and `preload.js` run
// in Node and are never bundled.
const RENDERER_ROOT = path.join(__dirname, "renderer");

export default defineConfig({
  root: RENDERER_ROOT,
  // Relative asset URLs. Electron loads the built page over `file://`, where an
  // absolute "/assets/..." would resolve against the filesystem root and 404.
  base: "./",
  plugins: [react()],
  css: {
    postcss: {
      // Scoped to renderer/src/theme/mock-v12.css only -- see that plugin's
      // own header for why this is not a blanket strip. Every other
      // stylesheet stays fully covered by no-hover-motion.test.ts.
      plugins: [stripMockHoverMotion()],
    },
  },
  build: {
    outDir: path.join(RENDERER_ROOT, "dist"),
    emptyOutDir: true,
    // The default CSS minifier treats a rule that writes BOTH a standard
    // property and its vendor-prefixed twin (mock-v12.css does this for
    // `backdrop-filter`, deliberately, on `.sec` and `.hud-nav`) as the same
    // property declared twice, and drops the standard one -- keeping only the
    // `-webkit-` fallback, which this Electron's Chromium no longer reads at
    // all. Measured: every card shipped with zero blur in the packaged build
    // while the dev server (unminified) showed it correctly, which is why the
    // restyle-5 audit -- run against the dev server -- never caught it.
    cssMinify: false,
  },
  server: {
    // Fixed port: `scripts/dev.mjs` hands this URL to Electron, so a silent
    // fallback to another port would leave the window pointing at nothing.
    port: 5273,
    strictPort: true,
  },
});
