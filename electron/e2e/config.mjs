import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ELECTRON_DIR = path.dirname(E2E_DIR);
export const REPO_ROOT = path.dirname(ELECTRON_DIR);

export const CONFIG = {
  // Pinned at the size the stored baseline (baseline/capture-tab.png) was shot
  // at, for harness.mjs / mock.spec.mjs's pixel-diff regression suite. NOT the
  // app's real default window size (that is 1100x900, settings/windowDefaults.ts)
  // -- changing this number invalidates the baseline image, not just the proof
  // reading it. A proof that needs the REAL default frames itself locally
  // instead of reading this constant (electron/e2e/default-window-proof.mjs).
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
