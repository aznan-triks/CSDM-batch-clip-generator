/**
 * Visual proof for the react-grid-layout workspace: launches the real window
 * and drives a REAL mouse drag and a REAL corner resize.
 *
 * Synthetic `dispatchEvent` gestures are deliberately not used: they do not
 * reach React's synthetic event system in this app, which is how a broken
 * grid passed a review in 3.2.3.
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
await page.waitForTimeout(1500);

await page.screenshot({ path: path.join(OUT, "grid-v3-before.png") });

const before = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  return items.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      title: el.querySelector(".t")?.textContent ?? "(untitled)",
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      // Does anything inside spill past the card?
      spills: [...el.querySelectorAll("*")].some((c) => c.getBoundingClientRect().bottom > r.bottom + 1),
    };
  });
});
console.log("=== BEFORE ===");
console.log(JSON.stringify(before, null, 2));

// --- Real drag: grab the second card's handle and move it left ---
const handle = page.locator('[role="tabpanel"]:not([hidden]) .drag-handle').nth(1);
const box = await handle.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x - 260, box.y + 160, { steps: 20 });
await page.screenshot({ path: path.join(OUT, "grid-v3-dragging.png") });
await page.mouse.up();
await page.waitForTimeout(400);

// --- Real resize: pull the first card's corner ---
const corner = page.locator('[role="tabpanel"]:not([hidden]) .react-resizable-handle').first();
const cbox = await corner.boundingBox();
await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
await page.mouse.down();
await page.mouse.move(cbox.x + 200, cbox.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(400);

const after = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  return items.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      title: el.querySelector(".t")?.textContent ?? "(untitled)",
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      spills: [...el.querySelectorAll("*")].some((c) => c.getBoundingClientRect().bottom > r.bottom + 1),
    };
  });
});
console.log("=== AFTER (drag + resize) ===");
console.log(JSON.stringify(after, null, 2));

await page.screenshot({ path: path.join(OUT, "grid-v3-after.png") });

const moved = JSON.stringify(before) !== JSON.stringify(after);
const anySpill = after.some((c) => c.spills);
console.log(`VERDICT: geometry changed = ${moved}; any card spilling = ${anySpill}`);

await app.close();
await server.close();
console.log("DONE");
