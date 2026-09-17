/**
 * Proof for the default card layout AS A REAL FIRST LAUNCH ACTUALLY SEES IT:
 * real engine (no CSDM_PYTHON_PATH override), real 1600x900 default window,
 * on whatever profile is active on this machine.
 *
 * `default-window-proof.mjs` deliberately runs with no engine, which means
 * it measures the pure auto-generated stack (`defaultLayout.ts`), never the
 * curated `DEFAULT_CONFIG["ui_sections"]` reference layout -- and, until
 * 2026-09-17, could pass green while a real launch still hit the ugly
 * auto-stack, because SectionList mounted before `load_config` answered and
 * treated every card as unconfigured. This proof exercises that real path:
 * no card may overflow its own scroller (a clipped control), and the total
 * scroll should stay well under the flat-24-rows baseline this replaced
 * (CAPTURE ~5300px, VIDEO ~3300px, SETTINGS ~3300px before 3.2.13).
 *
 * Run: node electron/e2e/default-layout-real-engine-proof.mjs
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

const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: 60000,
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const page = await app.firstWindow({ timeout: 60000 });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector(".brand-version", { timeout: 30000 });
await page.waitForTimeout(2000);

const TABS = ["CAPTURE", "VIDEO", "SETTINGS"];
const report = [];

try {
  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForTimeout(1000);
    const measured = await page.evaluate(() => {
      const pane = document.querySelector(".scrollwrap");
      const clipped = [...document.querySelectorAll(".sb-scroll")]
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .map((el) => {
          const id = el.closest("[data-card-id]")?.getAttribute("data-card-id") ?? "?";
          return { id, over: el.scrollHeight - el.clientHeight };
        });
      return { overflow: pane ? pane.scrollHeight - pane.clientHeight : -1, clipped };
    });
    report.push({ tab, ...measured });
    await page.screenshot({ path: path.join(SHOT_DIR, `default-layout-real-engine-${tab.toLowerCase()}.png`) });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  await server.close();
}

const bad = report.filter((r) => r.clipped.length > 0);
process.exit(bad.length === 0 ? 0 : 1);
