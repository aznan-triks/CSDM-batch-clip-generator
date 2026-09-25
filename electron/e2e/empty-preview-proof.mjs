/**
 * Axis A visual proof (audit finalisation 2026-09-25, §1 principle 8): an
 * empty preview explains itself on the EDITING tab, and DEMO SELECTION lights
 * the date shortcut whose range is on screen.
 *
 * Hermetic harness (no engine): the `preview_ready` an empty preview sends is
 * dispatched into the renderer's own store, the payload shape the engine's
 * `explain_empty_result` returns, with the numbers the off-app probe measured
 * on the real database.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SHOT_DIR } from "./config.mjs";
import { launchApp } from "./harness.mjs";

const OUT = path.join(SHOT_DIR, "empty-preview");
mkdirSync(OUT, { recursive: true });

const { page, close } = await launchApp();
try {
  await page.waitForSelector('[data-config-key="date_from"]', { timeout: 30000 });
  await page.getByRole("button", { name: "6m", exact: true }).click();
  await page.waitForTimeout(400);
  const card = page.locator(".react-grid-item").filter({ has: page.locator('[data-config-key="date_from"]') });
  await card.screenshot({ path: path.join(OUT, "demo-selection-6m-lit.png") });
  // The year must not be cut: the text fits its box.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".date-field-text")].map((el) => el.scrollWidth > el.clientWidth));
  console.log("date fields clipped:", JSON.stringify(clipped));

  await page.evaluate(async () => {
    const store = await import("/src/motion/engineStore.ts");
    store.dispatchEngineMessage("preview_ready", {
      sequences: {},
      cfg: {},
      empty_reason: {
        headline: "No clips: Weapon Filter removed the last 324 events.",
        hint: "Loosen Weapon Filter to get clips.",
        stages: [
          { label: "events for this player and event types (any date, no filter)", count: 10638 },
          { label: "date range 29-03-2026 → 25-09-2026 (Demo Selection)", count: 353 },
          { label: "Ally / Enemy (Capture & Timing > Event Type)", count: 324 },
          { label: "Weapon Filter", count: 0 },
        ],
      },
    });
  });
  await page.getByRole("tab", { name: /editing/i }).click();
  await page.waitForSelector(".editing-empty-reason", { timeout: 10000 });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-tab") === "editing");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "editing-empty-reason.png") });
  console.log("box:", await page.evaluate(() => {
    const box = document.querySelector(".editing-empty-box");
    const r = box.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 20, r.top + 20);
    return JSON.stringify({ bg: getComputedStyle(box).backgroundColor,
      topmost: top?.className?.toString?.() ?? String(top), tab: document.documentElement.dataset.tab });
  }));
  console.log(`shots in ${OUT}`);
} finally {
  await close();
}
