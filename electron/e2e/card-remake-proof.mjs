/**
 * Capture & Timing remake -- the three card styles next to their concepts
 * (§1 principle 8).
 *
 * Hermetic window (no engine), hidden (CSDM_E2E_BACKGROUND=1, set by the
 * harness). The style is switched the way a user does it (Settings > UI Theme
 * > Card style), the clip values are typed in once (the hermetic profile starts
 * every slider at its minimum) and the card is set to its REFERENCE slot from
 * DEFAULT_CONFIG (the hermetic profile has no config, so it opens at the
 * generic fallback size no user sees). Each shot is then put beside the
 * concept's own PNG: electron/e2e/output/card-remake/<style>-vs-concept.png.
 *
 * Usage: node e2e/card-remake-proof.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ELECTRON_DIR, REPO_ROOT, SHOT_DIR } from "./config.mjs";
import { launchApp } from "./harness.mjs";

const outDir = path.join(SHOT_DIR, "card-remake");
mkdirSync(outDir, { recursive: true });

const CONCEPTS = path.join(REPO_ROOT, "docs", "ui-restyle-mockups", "capture-remake");
const STYLES = [
  { style: "timeline", concept: "concept-a-timeline.png" },
  { style: "sentence", concept: "concept-b-sentence.png" },
  { style: "tiles", concept: "concept-c-moments-clip.png" },
];

const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

// The card's reference slot, read from DEFAULT_CONFIG rather than copied here.
const CONFIG_PY = readFileSync(path.resolve(ELECTRON_DIR, "..", "csdm", "config.py"), "utf8");
const slot = CONFIG_PY.match(/"capture-timing": \{"x": \d+, "y": \d+, "w": (\d+), "h": (\d+)\}/);
if (!slot) throw new Error("capture-timing slot not found in csdm/config.py");
const REF = { w: Number(slot[1]), h: Number(slot[2]) };

async function openTab(page, name) {
  const tab = page.getByRole("tab", { name: new RegExp(name, "i") }).first();
  // A click that lands while the previous tab is still leaving can be lost:
  // click until the tab says it is the selected one.
  for (let i = 0; i < 5 && (await tab.getAttribute("aria-selected")) !== "true"; i++) {
    await tab.click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector(`${CARD_ITEMS} .sh`, { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try { a.finish(); } catch (_) { /* infinite effect */ }
    }
  });
  await page.waitForTimeout(300);
}

/** Size the card to its reference slot, measure its content, shoot it. */
async function shootCard(page, name) {
  const index = await page.evaluate((sel) => {
    const items = [...document.querySelectorAll(sel)];
    const card = items.find((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes("capture & timing"));
    if (!card) return null;
    card.scrollIntoView({ block: "start" });
    return items.indexOf(card);
  }, CARD_ITEMS);
  if (index === null) {
    await page.screenshot({ path: path.join(outDir, `_fail-${name}.png`) });
    throw new Error("Capture & Timing card not found");
  }
  await settle(page);
  const widen = () => page.evaluate(
    ({ i, sel, ref }) => {
      const node = document.querySelectorAll(sel)[i];
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--block-gap")) || 0;
      // One column = the pane width shared out over its columns (15 at the
      // reference 1600x900 window, context in csdm/config.py `ui_sections`).
      const pane = node.parentElement.clientWidth;
      const col = (pane - 14 * gap) / 15;
      node.style.width = `${ref.w * col + (ref.w - 1) * gap}px`;
      node.style.zIndex = "50";
      // Keep the row, move to the pane's left edge: a card widened in place
      // would run past the pane on the right and be cut off.
      const y = /translate\([^,]+,\s*([-\d.]+)px/.exec(node.style.transform)?.[1] ?? "0";
      node.style.transform = `translate(0px, ${y}px)`;
    },
    { i: index, sel: CARD_ITEMS, ref: REF },
  );
  // The grid re-renders its item once after the first write and puts its own
  // width back; the second write sticks. Then let the card re-measure itself
  // (the timeline reads its width through a ResizeObserver).
  await widen();
  await page.waitForTimeout(400);
  await widen();
  await page.waitForTimeout(400);
  const rows = await page.evaluate(
    ({ i, sel, ref }) => {
      const node = document.querySelectorAll(sel)[i];
      const css = getComputedStyle(document.documentElement);
      const row = parseFloat(css.getPropertyValue("--block-row")) || 24;
      const gap = parseFloat(css.getPropertyValue("--block-gap")) || 0;
      // Content height: card top to the bottom of the style's own body, plus
      // the body padding under it.
      const body = node.querySelector(".ct-a, .ct-b, .ct-c");
      // The body may stretch to its card; its children do not.
      const bottom = Math.max(...[...body.querySelectorAll(":scope > *")].map((c) => c.getBoundingClientRect().bottom));
      const natural = Math.ceil(bottom - node.getBoundingClientRect().top + 16);
      node.style.height = `${ref.h * row + (ref.h - 1) * gap}px`;
      return { width: node.style.width, natural, rows: Math.ceil((natural + gap) / (row + gap)), referenceRows: ref.h };
    },
    { i: index, sel: CARD_ITEMS, ref: REF },
  );
  await page.waitForTimeout(300);
  const file = path.join(outDir, `app-${name}.png`);
  await page.locator(CARD_ITEMS).nth(index).screenshot({ path: file });
  console.log(file, JSON.stringify(rows));
  return file;
}

async function chooseStyle(page, style) {
  await openTab(page, "settings");
  await page.getByRole("radiogroup", { name: "Card style" }).getByRole("radio", { name: style }).click();
  await page.waitForTimeout(300);
  await openTab(page, "capture");
}

const { page, close } = await launchApp();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
const shots = [];
try {
  await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
  // Type the engine's defaults in once, from the tiles style: its sliders are
  // plain number boxes. Every style reads the same keys afterwards.
  await chooseStyle(page, "tiles");
  await page.getByRole("radio", { name: "both" }).first().click();
  await page.waitForTimeout(200);
  for (const [id, value] of [["seconds-before", "3"], ["seconds-after", "5"], ["victim-pre-s", "2"]]) {
    await page.locator(`#${id}-number`).fill(value);
  }
  await page.waitForTimeout(300);
  for (const { style, concept } of STYLES) {
    await chooseStyle(page, style);
    const apps = [await shootCard(page, style)];
    if (style === "sentence") {
      // The concept also draws a word open: "kills" with its popover.
      await page.getByRole("button", { name: "What to capture" }).click();
      await page.waitForTimeout(300);
      apps.push(await shootCard(page, "sentence-open"));
      await page.keyboard.press("Escape");
    }
    shots.push({ style, apps, concept: path.join(CONCEPTS, concept) });
  }
  // Leave the hermetic profile on its default style.
  await chooseStyle(page, "timeline");
  // The setting itself, where the user finds it.
  await openTab(page, "settings");
  const theme = page.locator(CARD_ITEMS).filter({ hasText: "UI Theme" }).first();
  await theme.scrollIntoViewIfNeeded();
  await settle(page);
  const themeFile = path.join(outDir, "settings-ui-theme.png");
  await theme.screenshot({ path: themeFile });
  console.log(themeFile);

  // Side by side: the app's card left, the concept right, same height.
  await page.setViewportSize({ width: 3000, height: 620 });
  for (const { style, apps, concept } of shots) {
    const html = `<!doctype html><body style="margin:0;background:#e9eef5;display:flex;gap:24px;padding:20px;align-items:flex-start;font:600 14px sans-serif">
      ${apps.map((app) => `<figure style="margin:0"><figcaption>APP -- ${path.basename(app, ".png")}</figcaption><img src="${pathToFileURL(app).href}" style="height:560px"></figure>`).join("")}
      <figure style="margin:0"><figcaption>CONCEPT</figcaption><img src="${pathToFileURL(concept).href}" style="height:560px"></figure></body>`;
    const htmlFile = path.join(outDir, `_sbs-${style}.html`);
    (await import("node:fs")).writeFileSync(htmlFile, html);
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForTimeout(600);
    const file = path.join(outDir, `${style}-vs-concept.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} finally {
  await close();
}
