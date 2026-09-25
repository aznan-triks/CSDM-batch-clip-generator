/**
 * Capture & Timing / Timing & Retries -- card screenshots (§1 principle 8).
 *
 * Hermetic window (no engine): the cards render from the window defaults,
 * which is all this proof needs -- it photographs structure, labels and the
 * summary line, not engine data. Hidden window (CSDM_E2E_BACKGROUND=1, set by
 * the harness).
 *
 * The capture card is shot twice: on the default camera (killer) and on
 * `both`, which shows every conditional row (victim view, Mate POV). With a
 * mockup path, the mock's own Capture & Timing card is shot last, from the
 * same window, for the side-by-side.
 *
 * Usage: node e2e/capture-timing-proof.mjs <label> [outSubdir] [mockupHtml]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";
import { launchApp } from "./harness.mjs";

const label = process.argv[2] ?? "shot";
const outDir = path.join(SHOT_DIR, process.argv[3] ?? "capture-timing");
const mockup = process.argv[4];
mkdirSync(outDir, { recursive: true });

const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

// Each card's reference height (fine rows), read from DEFAULT_CONFIG rather
// than copied here, so the proof shows the height a fresh install gets.
const CONFIG_PY = readFileSync(path.resolve(ELECTRON_DIR, "..", "csdm", "config.py"), "utf8");
const REFERENCE_ROWS = Object.fromEntries(
  ["capture-timing", "timing-retries"].map((id) => {
    const m = CONFIG_PY.match(new RegExp(`"${id}": \\{[^}]*"h": (\\d+)`));
    return [id, m ? Number(m[1]) : null];
  }),
);

async function shootCard(page, cardId, title, name) {
  const index = await page.evaluate(
    ({ t, sel }) => {
      const items = [...document.querySelectorAll(sel)];
      const card = items.find((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes(t));
      if (!card) return null;
      card.scrollIntoView({ block: "start" });
      return items.indexOf(card);
    },
    { t: title, sel: CARD_ITEMS },
  );
  if (index === null) throw new Error(`card "${title}" not found`);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try { a.finish(); } catch (_) { /* infinite effect */ }
    }
  });
  await page.waitForTimeout(300);
  // The card's content height in grid rows, measured the way the config's
  // reference heights were (csdm/config.py, `ui_sections`): card chrome plus
  // the body's own content, the scroller shrunk to 1px so a card taller than
  // its content cannot hide the excess. Then the card is set to the height
  // its REFERENCE slot gives it: the hermetic profile has no config, so its
  // cards open at the generic fallback height, which no user ever sees.
  const rows = await page.evaluate(
    ({ i, sel, h }) => {
      const node = document.querySelectorAll(sel)[i];
      const scroller = node.querySelector(".sb-scroll");
      const css = getComputedStyle(document.documentElement);
      const row = parseFloat(css.getPropertyValue("--block-row")) || 24;
      const gap = parseFloat(css.getPropertyValue("--block-gap")) || 0;
      const chrome = node.offsetHeight - scroller.clientHeight;
      const saved = scroller.style.flex;
      scroller.style.flex = "0 0 1px";
      const natural = chrome + scroller.scrollHeight;
      scroller.style.flex = saved;
      if (h) node.style.height = `${h * row + (h - 1) * gap}px`;
      return { natural, rows: Math.ceil((natural + gap) / (row + gap)), referenceRows: h };
    },
    { i: index, sel: CARD_ITEMS, h: REFERENCE_ROWS[cardId] },
  );
  await page.waitForTimeout(200);
  const file = path.join(outDir, `${label}-${name}.png`);
  await page.locator(CARD_ITEMS).nth(index).screenshot({ path: file });
  console.log(file, JSON.stringify(rows));
}

async function choose(page, option) {
  const radio = page.getByRole("radio", { name: option });
  if (await radio.count()) await radio.first().click();
  await page.waitForTimeout(600);
}

const { page, close } = await launchApp();
try {
  await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
  await choose(page, "killer");
  await shootCard(page, "capture-timing", "capture & timing", "capture-killer");
  await choose(page, "both");
  // The engine's own defaults (before 3, after 5, victim view 2), typed in:
  // the hermetic profile starts every slider at its minimum, which draws a
  // clip no one records.
  for (const [id, value] of [["seconds-before", "3"], ["seconds-after", "5"], ["victim-pre-s", "2"]]) {
    await page.locator(`#${id}-number`).fill(value);
  }
  await page.waitForTimeout(300);
  await shootCard(page, "capture-timing", "capture & timing", "capture-both");
  for (const [id, value] of [["retry-count", "2"], ["retry-delay", "15"], ["demo-pause", "3"]]) {
    await page.locator(`#${id}`).fill(value);
  }
  await page.waitForTimeout(300);
  await shootCard(page, "timing-retries", "timing & retries", "retries");
  // Leave the hermetic profile on its default camera.
  await choose(page, "killer");

  if (mockup && existsSync(mockup)) {
    await page.goto(pathToFileURL(mockup).href);
    await page.waitForTimeout(1500);
    const sec = page.locator("#view-capture .sec").filter({ hasText: "Capture & Timing" }).first();
    const file = path.join(outDir, "mockup-v12-capture.png");
    await sec.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await close();
}
