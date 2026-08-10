/**
 * Proof that the resize corner is on the card's frame: measures where the
 * handle lives in the DOM, that the gold bracket actually renders, that the
 * pointer reaches it, and that dragging it really resizes the card.
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

const audit = await page.evaluate(() => {
  const item = document.querySelector('[role="tabpanel"]:not([hidden]) .react-grid-item');
  const handle = item.querySelector(".react-resizable-handle");
  const body = item.querySelector(".sb-scroll");
  const ir = item.getBoundingClientRect();
  const hr = handle.getBoundingClientRect();
  const after = getComputedStyle(handle, "::after");
  const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
  return {
    handleIsDirectChild: handle.parentElement === item,
    handleInsideScrollBody: Boolean(body?.contains(handle)),
    handleAtBottomRight: Math.abs(hr.bottom - ir.bottom) < 12 && Math.abs(hr.right - ir.right) < 12,
    bracketBorders: `${after.borderRightWidth} / ${after.borderBottomWidth}`,
    bracketVisible: parseFloat(after.borderRightWidth) > 0 && parseFloat(after.borderBottomWidth) > 0,
    pointerReachesHandle: hit === handle || handle.contains(hit),
  };
});
console.log(JSON.stringify(audit, null, 2));

// A real drag on the corner must actually change the card's height.
const before = await page.evaluate(() =>
  Math.round(document.querySelector('[role="tabpanel"]:not([hidden]) .react-grid-item').getBoundingClientRect().height),
);
const corner = page.locator('[role="tabpanel"]:not([hidden]) .react-resizable-handle').first();
const cb = await corner.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.mouse.down();
await page.mouse.move(cb.x + 40, cb.y + 150, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(500);
const after = await page.evaluate(() =>
  Math.round(document.querySelector('[role="tabpanel"]:not([hidden]) .react-grid-item').getBoundingClientRect().height),
);
await page.screenshot({ path: path.join(OUT, "resize-handle-after.png") });

console.log(`height ${before} -> ${after}`);
const ok =
  audit.handleIsDirectChild &&
  !audit.handleInsideScrollBody &&
  audit.handleAtBottomRight &&
  audit.bracketVisible &&
  audit.pointerReachesHandle &&
  after > before;
console.log(`VERDICT: handle on frame, visible, grabbable, resizes = ${ok}`);

await app.close();
await server.close();
process.exitCode = ok ? 0 : 1;
