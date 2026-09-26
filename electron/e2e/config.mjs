import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ELECTRON_DIR = path.dirname(E2E_DIR);
export const REPO_ROOT = path.dirname(ELECTRON_DIR);

export const CONFIG = {
  // Pinned at the size the stored baseline (baseline/capture-tab.png) was shot
  // at, for harness.mjs / mock.spec.mjs's pixel-diff regression suite. Also the
  // app's real default window size today (settings/windowDefaults.ts) -- that
  // wasn't always true (it was 1100x900 between v3.2.3 and v3.2.7), so a proof
  // that needs the REAL default still frames itself locally rather than
  // trusting the two staying equal (electron/e2e/default-window-proof.mjs).
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

/**
 * A throwaway settings profile for any proof that runs the REAL engine.
 *
 * The engine reads and rewrites <checkout>/CSDM-batch-clip_config; a proof
 * launched from the main checkout used to do both on the user's real settings
 * (favourites, layout). The checkout's files are COPIED (read-only source) so
 * the proof still reaches the real database, then CSDM_PROFILE_ROOT points
 * the engine at the copy (csdm/config.py). Spread the result into `env`.
 */
export function isolatedProfileEnv() {
  const root = mkdtempSync(path.join(os.tmpdir(), "csdm-e2e-profile-"));
  const source = path.join(REPO_ROOT, "CSDM-batch-clip_config");
  const target = path.join(root, "CSDM-batch-clip_config");
  mkdirSync(target, { recursive: true });
  for (const name of ["csdm_config.json", "csdm_presets.json", "csdm_players.json", "csdm_asm_names.json"]) {
    if (existsSync(path.join(source, name))) copyFileSync(path.join(source, name), path.join(target, name));
  }
  return { CSDM_PROFILE_ROOT: root };
}
