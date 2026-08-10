/**
 * Proof that collapsing a card shrinks its rectangle and expanding restores
 * the exact height it had -- the 3.2.1 grid left 377px of empty card under
 * the header of a collapsed card (audit 2026-08-10).
 */
import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import { mkdirSync } from "node:fs";

const ELECTRON_DIR = process.cwd();
const OUT = path.join(ELECTRON_DIR, "e2e", "output");
mkdirSync(OUT, { recursive: true });

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];

const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: 30000,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine" },
});
const page = await app.firstWindow({ timeout: 30000 });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(1800);

// Make sure the first card is expanded to start from a known state.
const first = page.locator('[role="tabpanel"]:not([hidden]) .sh').first();
if ((await first.getAttribute("aria-expanded")) === "false") {
  await first.click();
  await page.waitForTimeout(600);
}

const measure = () =>
  page.evaluate(() => {
    const item = document.querySelector('[role="tabpanel"]:not([hidden]) .react-grid-item');
    const header = item.querySelector(".sh");
    const ir = item.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    return {
      cardH: Math.round(ir.height),
      headerH: Math.round(hr.height),
      emptyBelowHeader: Math.round(ir.bottom - hr.bottom),
    };
  });

const expanded = await measure();
await first.click();
await page.waitForTimeout(700);
const collapsed = await measure();
await page.screenshot({ path: path.join(OUT, "collapse-collapsed.png") });
await first.click();
await page.waitForTimeout(700);
const reExpanded = await measure();
await page.screenshot({ path: path.join(OUT, "collapse-reexpanded.png") });

console.log(JSON.stringify({ expanded, collapsed, reExpanded }, null, 2));
const shrank = collapsed.cardH < expanded.cardH;
// A collapsed card should be its header plus the card's own padding, not a
// tall empty box. 24px of slack covers the frame's border and radius.
const tight = collapsed.emptyBelowHeader <= 24;
const restored = reExpanded.cardH === expanded.cardH;
console.log(`VERDICT: shrank = ${shrank}; tight = ${tight}; height restored = ${restored}`);

await app.close();
await server.close();
process.exitCode = shrank && tight && restored ? 0 : 1;
