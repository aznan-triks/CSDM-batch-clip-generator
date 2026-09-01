/**
 * Launch the real window with the real engine.
 *
 * `harness.mjs` is the hermetic one: it points `CSDM_PYTHON_PATH` at a name
 * that cannot resolve, on purpose, because the visual suite is not about the
 * engine. The audit scripts need the opposite -- a real Python child and a
 * real database -- so the two launchers stay separate rather than one
 * launcher with a flag that decides whether the app under test is real.
 *
 * CS2 is never started by anything using this. PREVIEW is a dry run.
 */
import path from "node:path";

import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";

import { CONFIG, ELECTRON_DIR } from "./config.mjs";

export async function launchWithEngine() {
  const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    await server.close();
    throw new Error("Vite started but reported no local URL -- port 5273 is probably taken");
  }

  // The engine env is cleaned the way `exe-smoke-proof.mjs` cleans it: a stray
  // PYTHONPATH or VIRTUAL_ENV from the launching shell makes the child import
  // a different tree than the one under test, and the resulting failure looks
  // exactly like a product bug.
  const env = { ...process.env, VITE_DEV_SERVER_URL: url };
  delete env.PYTHONPATH;
  delete env.VIRTUAL_ENV;

  const app = await electron.launch({
    args: [ELECTRON_DIR],
    cwd: ELECTRON_DIR,
    timeout: CONFIG.launchTimeoutMs,
    env,
  });
  const page = await app.firstWindow({ timeout: CONFIG.launchTimeoutMs });
  await page.setViewportSize(CONFIG.viewport);
  await page.waitForLoadState("domcontentloaded");
  return { app, page, close: async () => { await app.close(); await server.close(); } };
}

/** Wait for the engine's greeting, the one proof that the child is alive. */
export async function waitForEngine(page, timeoutMs) {
  return page
    .locator(".console .body")
    .filter({ hasText: "engine ready" })
    .first()
    .waitFor({ timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}
