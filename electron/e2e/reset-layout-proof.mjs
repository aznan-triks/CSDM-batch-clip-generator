/**
 * Proof that "Reset card layout" really puts the cards back: snapshot the
 * reference layout, move a card, reset, and compare against the snapshot.
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
await page.waitForTimeout(1800);

const snapshot = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.querySelector(".t")?.textContent}@${Math.round(r.left)},${Math.round(r.top)}`;
    }),
  );

// Reset first, so the "reference" we record is the real reference.
await page.locator('[role="tab"]', { hasText: /settings/i }).first().click();
await page.waitForTimeout(500);
await page.locator('button[data-action="M8"]').click();
await page.waitForTimeout(900);
await page.locator('[role="tab"]', { hasText: /capture/i }).first().click();
await page.waitForTimeout(700);
const reference = await snapshot();

// Move a card well away from where it started. Scrolled into view first: a
// handle even a few pixels below the viewport receives no real mouse event
// (the exact mistake that produced two inconclusive audit passes on
// 2026-08-10) -- `boundingBox()` reports layout position regardless of
// on-screen visibility.
const handle = page.locator('[role="tabpanel"]:not([hidden]) .drag-handle').nth(1);
await handle.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await handle.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 400, box.y + 260, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(900);
const moved = await snapshot();

// Reset and compare.
await page.locator('[role="tab"]', { hasText: /settings/i }).first().click();
await page.waitForTimeout(500);
await page.locator('button[data-action="M8"]').click();
await page.waitForTimeout(900);
await page.locator('[role="tab"]', { hasText: /capture/i }).first().click();
await page.waitForTimeout(700);
const afterReset = await snapshot();

console.log(JSON.stringify({ reference, moved, afterReset }, null, 2));
const changed = JSON.stringify(reference) !== JSON.stringify(moved);
const restored = JSON.stringify(reference) === JSON.stringify(afterReset);
console.log(`VERDICT: drag changed the layout = ${changed}; reset restored the reference = ${restored}`);

await app.close();
await server.close();
process.exitCode = changed && restored ? 0 : 1;
