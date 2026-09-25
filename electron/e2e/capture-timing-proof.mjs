/**
 * Capture & Timing / Timing & Retries -- card screenshots (§1 principle 8).
 *
 * Hermetic window (no engine): the cards render from the window defaults,
 * which is all this proof needs -- it photographs structure, labels and the
 * summary line, not engine data. Hidden window (CSDM_E2E_BACKGROUND=1, set by
 * the harness).
 *
 * Usage: node e2e/capture-timing-proof.mjs <label>   (e.g. before / after)
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SHOT_DIR } from "./config.mjs";
import { launchApp } from "./harness.mjs";

const label = process.argv[2] ?? "shot";
const outDir = path.join(SHOT_DIR, "capture-timing");
mkdirSync(outDir, { recursive: true });

const CARDS = [
  ["capture", "capture & timing"],
  ["retries", "timing & retries"],
];

const { page, close } = await launchApp();
try {
  await page.waitForSelector('[role="tabpanel"]:not([hidden]) .react-grid-item', { timeout: 30000 });
  // Both perspective shows every conditional row (switch delay, Mate POV).
  const both = page.getByRole("radio", { name: "both" });
  if (await both.count()) await both.first().click();
  await page.waitForTimeout(600);
  for (const [name, title] of CARDS) {
    const index = await page.evaluate((t) => {
      const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
      const card = items.find((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes(t));
      if (!card) return null;
      card.scrollIntoView({ block: "start" });
      return items.indexOf(card);
    }, title);
    if (index === null) throw new Error(`card "${title}" not found`);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try { a.finish(); } catch (_) { /* infinite effect */ }
      }
    });
    await page.waitForTimeout(300);
    const file = path.join(outDir, `${label}-${name}.png`);
    await page.locator('[role="tabpanel"]:not([hidden]) .react-grid-item').nth(index).screenshot({ path: file });
    console.log(file);
  }
} finally {
  await close();
}
