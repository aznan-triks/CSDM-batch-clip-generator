/**
 * Proof for the default window: at 1100x900 (the real default, see
 * settings/windowDefaults.ts -- NOT CONFIG.viewport, which stays pinned at
 * 1600x900 for the unrelated baseline pixel-diff suite), on a profile with
 * no stored card layout, no tab may need a vertical scrollbar on first
 * paint, and no card may clip its own content.
 *
 * The scrollbar IS the measurement, per the criterion set on 2026-08-10: if
 * `.scrollwrap` can scroll before the user has touched anything, the
 * reference layout does not fit the window it was derived for.
 *
 * The engine is deliberately absent (CSDM_PYTHON_PATH points at nothing), so
 * the renderer falls back to DEFAULT_CONFIG -- `ui_sections` is empty, which
 * is exactly the fresh-install state the reference layout is about.
 */
import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { CONFIG, ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const DEFAULT_VIEWPORT = { width: 1100, height: 900 };

mkdirSync(SHOT_DIR, { recursive: true });

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];

const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: CONFIG.launchTimeoutMs,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine" },
});
const page = await app.firstWindow({ timeout: CONFIG.launchTimeoutMs });
await page.setViewportSize(DEFAULT_VIEWPORT);
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(1500);

const TABS = ["CAPTURE", "EDITING", "TAGS", "VIDEO", "SETTINGS"];
const report = [];

for (const tab of TABS) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(600);
  const measured = await page.evaluate(() => {
    const pane = document.querySelector(".scrollwrap");
    const clipped = [...document.querySelectorAll(".sb-scroll")]
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.closest("[data-card-id]")?.getAttribute("data-card-id") ?? "?");
    return { overflow: pane ? pane.scrollHeight - pane.clientHeight : -1, clipped };
  });
  report.push({ tab, ...measured });
  await page.screenshot({ path: path.join(SHOT_DIR, `default-window-${tab.toLowerCase()}.png`) });
}

writeFileSync(path.join(SHOT_DIR, "default-window-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await app.close();
await server.close();

const bad = report.filter((r) => r.overflow > 0 || r.clipped.length > 0);
process.exit(bad.length === 0 ? 0 : 1);
