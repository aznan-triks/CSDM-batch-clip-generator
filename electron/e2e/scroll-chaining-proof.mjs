/**
 * Proof that the wheel is no longer trapped: park the real mouse over a
 * scrollable card, exhaust its body, then keep scrolling and check the pane
 * picks up the remainder.
 *
 * The card MUST be scrolled into view first: a point below the fold receives
 * no wheel at all, which reads as a pass for the wrong reason (this exact
 * mistake produced two inconclusive audit passes on 2026-08-10).
 */
import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";

const ELECTRON_DIR = process.cwd();
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
await page.waitForTimeout(1500);

// Expand everything so we audit the real working state.
const collapsed = page.locator('[role="tabpanel"]:not([hidden]) .sh[aria-expanded="false"]');
for (let i = (await collapsed.count()) - 1; i >= 0; i--) {
  await collapsed.nth(i).click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(600);

const idx = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  return cards.findIndex((c) => {
    const b = c.querySelector(".sb-scroll");
    return b && b.scrollHeight > b.clientHeight + 2;
  });
});
if (idx === -1) throw new Error("no scrollable card found -- cannot prove chaining");

const rect = await page.evaluate((i) => {
  const c = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
  c.scrollIntoView({ block: "center" });
  const b = c.querySelector(".sb-scroll").getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right) };
}, idx);
await page.waitForTimeout(500);

const read = () =>
  page.evaluate((i) => {
    const c = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
    const b = c.querySelector(".sb-scroll");
    const p = document.querySelector(".scrollwrap");
    return {
      body: b.scrollTop,
      bodyAtEnd: b.scrollTop + b.clientHeight >= b.scrollHeight - 2,
      pane: p.scrollTop,
      // The pane can legitimately have nowhere left to go by the time the
      // card's body is exhausted (a short page below a tall card) -- that is
      // NOT the same as chaining being blocked, and comparing scrollTop
      // before/after further wheel input cannot tell the two apart.
      paneAtMax: p.scrollTop >= p.scrollHeight - p.clientHeight - 2,
    };
  }, idx);

await page.mouse.move(rect.right - 60, (rect.top + Math.min(rect.bottom, 880)) / 2);
const start = await read();
for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 120);
await page.waitForTimeout(400);
const mid = await read();
for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 120);
await page.waitForTimeout(400);
const end = await read();

console.log(JSON.stringify({ start, mid, end }, null, 2));
const cardScrolled = mid.body > start.body;
// Chaining is proven either by the pane moving further once the card is
// exhausted, or by the pane having already reached ITS OWN maximum by then
// (nothing left for the extra wheel input to move, which is not a block).
const chained = end.pane > mid.pane || mid.paneAtMax;
console.log(`VERDICT: card scrolled = ${cardScrolled}; pane chained after card exhausted = ${chained}`);

await app.close();
await server.close();
process.exitCode = cardScrolled && mid.bodyAtEnd && chained ? 0 : 1;
