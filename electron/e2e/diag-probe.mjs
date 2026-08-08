/**
 * Probe: what does slot()'s column-count read actually return, and why?
 */
import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";

const ELECTRON_DIR = process.cwd();
const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const app = await electron.launch({
  args: [ELECTRON_DIR], cwd: ELECTRON_DIR, timeout: 30000,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine" },
});
const page = await app.firstWindow({ timeout: 30000 });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  return {
    panelCount: panels.length,
    panels: panels.map((p) => ({
      label: p.getAttribute("aria-label"),
      hidden: p.hasAttribute("hidden"),
      bentos: p.querySelectorAll(".bento").length,
      gridCols: (() => {
        const b = p.querySelector(".bento");
        return b ? getComputedStyle(b).gridTemplateColumns : null;
      })(),
    })),
    allBentos: [...document.querySelectorAll(".bento")].map((b) => ({
      display: getComputedStyle(b).display,
      cols: getComputedStyle(b).gridTemplateColumns,
      colsLen: getComputedStyle(b).gridTemplateColumns.split(" ").length,
    })),
  };
});
console.log(JSON.stringify(probe, null, 2));

await app.close();
await server.close();
