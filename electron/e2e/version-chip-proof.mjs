/**
 * One-off visual proof: the running build's version chip in the top bar.
 *
 * Launches Electron against the REAL engine (no CSDM_PYTHON_PATH override),
 * waits for the `.brand-version` chip -- which only appears after the
 * engine's `hello` reply names the build -- and photographs the nav band
 * plus the full window.
 *
 * Run: node electron/e2e/version-chip-proof.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

mkdirSync(SHOT_DIR, { recursive: true });

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) {
  await server.close();
  throw new Error("Vite started but reported no local URL");
}

const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: 60000,
  // No CSDM_PYTHON_PATH override: the real engine must answer `hello`.
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForLoadState("domcontentloaded");

  await page.waitForSelector(".brand-version", { timeout: 30000 });
  const chipText = await page.locator(".brand-version").textContent();
  console.log(`version chip text: ${JSON.stringify(chipText)}`);

  const probe = () =>
    page.evaluate(() => {
      const chip = document.querySelector(".brand-version");
      const rect = chip?.getBoundingClientRect();
      const style = chip ? getComputedStyle(chip) : null;
      return {
        rect: rect
          ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          : null,
        font: style ? style.fontSize : null,
        color: style ? style.color : null,
        border: style ? style.borderRadius : null,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

  console.log("at 1280x800:", JSON.stringify(await probe()));

  await page.setViewportSize({ width: 900, height: 640 });
  await page.waitForTimeout(150);
  console.log("at 900x640:", JSON.stringify(await probe()));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch (_) {
        /* infinite target effect end */
      }
    }
  });

  const hudPath = path.join(SHOT_DIR, "version-chip-hud.png");
  await page.locator(".hud-nav").screenshot({ path: hudPath });
  const fullPath = path.join(SHOT_DIR, "version-chip-full.png");
  await page.screenshot({ path: fullPath });
  console.log(`wrote ${hudPath}`);
  console.log(`wrote ${fullPath}`);
} finally {
  await app.close();
  await server.close();
}
