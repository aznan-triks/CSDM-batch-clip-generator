/**
 * Probe: run autoPlace logic with the real inputs to see why cards stack.
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
  // Replicate autoPlace exactly as in sectionLayout.ts
  function autoPlace(existing, colSpan, rowSpan, cols) {
    const grid = new Map();
    for (const slot of Object.values(existing)) {
      for (let r = slot.row; r < slot.row + slot.rowSpan; r++) {
        for (let c = slot.col; c < slot.col + slot.colSpan; c++) {
          grid.set(`${c},${r}`, true);
        }
      }
    }
    for (let row = 1; row <= 100; row++) {
      for (let col = 1; col + colSpan - 1 <= cols; col++) {
        let fits = true;
        for (let dr = 0; dr < rowSpan && fits; dr++) {
          for (let dc = 0; dc < colSpan && fits; dc++) {
            if (grid.has(`${col + dc},${row + dr}`)) fits = false;
          }
        }
        if (fits) return { col, row, colSpan, rowSpan };
      }
    }
    const maxRow = Object.values(existing).reduce((m, s) => Math.max(m, s.row + s.rowSpan - 1), 0);
    return { col: 1, row: maxRow + 1, colSpan, rowSpan };
  }

  // Simulate sequential slot() calls
  const autoPlaced = {};
  const results = [];
  const cols = 10;
  for (let i = 0; i < 7; i++) {
    const id = "card" + i;
    const known = { ...{}, ...autoPlaced };
    const placed = autoPlace(known, 3, 1, cols);
    autoPlaced[id] = placed;
    results.push({ id, placed });
  }
  return { results };
});
console.log(JSON.stringify(probe, null, 2));

await app.close();
await server.close();
