import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ELECTRON_DIR = path.dirname(E2E_DIR);
export const REPO_ROOT = path.dirname(ELECTRON_DIR);

export const CONFIG = {
  // The window's own default geometry (main.js WINDOW_DEFAULT_W / _H). Shots
  // taken at any other size would compare against a layout the app never has.
  viewport: { width: 1600, height: 900 },
  // Share of pixels allowed to differ before a shot counts as a regression.
  diffThreshold: 0.01,
  // Electron has to start, Vite has to serve and React has to mount.
  launchTimeoutMs: 30000,
  // The approved mock, for the side-by-side sheet only -- never compared pixel
  // to pixel: it shows invented data, the app shows real data.
  mockPath: path.join(REPO_ROOT, "docs", "ui-restyle-mockups", "mockup-v12-hologlass.html"),
};

export const SHOT_DIR = path.join(E2E_DIR, "output");
export const BASELINE_DIR = path.join(E2E_DIR, "baseline");
