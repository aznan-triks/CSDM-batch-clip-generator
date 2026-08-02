import { mkdirSync } from "node:fs";
import path from "node:path";

import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";

import { CONFIG, ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

/**
 * Start Vite, then Electron pointed at it, then hand back the first window.
 *
 * Same sequence as scripts/dev.mjs -- and for the same reason: Electron
 * launched before the server is listening opens on a connection refused and
 * stays blank, which here would photograph as a plausible-looking black frame.
 *
 * CSDM_PYTHON_PATH is set to a name that cannot resolve on purpose. The engine
 * is not what these tests are about, and bridge.ts already handles its absence
 * explicitly ("no engine bridge on this page"). This is what makes the suite
 * hermetic: no database, no Python, no CS2.
 */
export async function launchApp() {
  mkdirSync(SHOT_DIR, { recursive: true });

  const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    await server.close();
    throw new Error("Vite started but reported no local URL -- port 5273 is probably taken");
  }

  const app = await electron.launch({
    args: [ELECTRON_DIR],
    cwd: ELECTRON_DIR,
    timeout: CONFIG.launchTimeoutMs,
    env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine" },
  });

  const page = await app.firstWindow({ timeout: CONFIG.launchTimeoutMs });
  await page.setViewportSize(CONFIG.viewport);
  await page.waitForLoadState("domcontentloaded");

  return {
    app,
    page,
    async close() {
      await app.close();
      await server.close();
    },
  };
}

/**
 * Take a shot with every animation settled.
 *
 * `document.getAnimations().forEach(a => a.finish())` is the same precaution
 * §10 records for colour readings: a CSS transition mid-flight photographs its
 * starting value, and the difference is invisible in the resulting PNG.
 */
export async function shoot(page, name) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      // Infinite animations (repeat:Infinity) cannot be finished -- skip them.
      try { a.finish(); } catch (_) { /* infinite target effect end */ }
    }
  });
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
