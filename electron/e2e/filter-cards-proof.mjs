/**
 * Filter cards remake (Weapon / Kill / Damage / Shot Filters) -- each card in
 * each of the three card styles (§1 principle 8).
 *
 * Real engine (the cards are built from `describe_filters` and the weapons
 * the database holds), hidden window (CSDM_E2E_BACKGROUND=1), run from a
 * worktree whose own CSDM-batch-clip_config/ is an isolated profile -- never
 * the user's. A few filters are switched on first so every state (kept,
 * required, dropped, untested) is on screen, then each card is grown to its
 * content height and shot:
 *   electron/e2e/output/card-remake-2a/<card>-<style>.png
 *
 * Usage: node e2e/filter-cards-proof.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SHOT_DIR } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const outDir = path.join(SHOT_DIR, "card-remake-2a");
mkdirSync(outDir, { recursive: true });

const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';
const CARDS = [
  { id: "weapon-filter", file: "weapon-filter" },
  { id: "kill-filters", file: "kill-filters" },
  { id: "damage-filters", file: "damage-filters" },
  { id: "shot-filters", file: "shot-filters" },
];
const STYLES = ["timeline", "sentence", "tiles"];

async function openTab(page, name) {
  const tab = page.getByRole("tab", { name: new RegExp(name, "i") }).first();
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

async function chooseStyle(page, style) {
  await openTab(page, "settings");
  await page.getByRole("radiogroup", { name: "Card style" }).getByRole("radio", { name: style }).click();
  await page.waitForTimeout(300);
  await openTab(page, "capture");
}

/** Click a key's own control, found through its coverage wrapper. */
async function press(page, key, nth = 0) {
  await page.locator(`[data-card-id] [data-config-key="${key}"] button`).nth(nth).click();
  await page.waitForTimeout(120);
}

/** Grow the card to its content height (no inner scroll), then shoot it. */
async function shootCard(page, id, name) {
  const card = page.locator(`[data-card-id="${id}"]`);
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  const size = await card.evaluate((node) => {
    const scroll = node.querySelector(".sb-scroll") ?? node.querySelector(".sb");
    const head = node.querySelector(".sh");
    const natural = Math.ceil((head?.getBoundingClientRect().height ?? 0) + (scroll?.scrollHeight ?? 0) + 24);
    node.style.height = `${Math.max(natural, node.getBoundingClientRect().height)}px`;
    node.style.zIndex = "50";
    return { w: Math.round(node.getBoundingClientRect().width), h: natural };
  });
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${name}.png`);
  await card.screenshot({ path: file });
  console.log(file, JSON.stringify(size));
}

const { page, close } = await launchWithEngine();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
try {
  if (!(await waitForEngine(page, 60000))) throw new Error("engine never said ready");
  // Tall enough that a card grown to its content is never cut by the window.
  await page.setViewportSize({ width: 1600, height: 2600 });
  await chooseStyle(page, "timeline");
  // The weapon rack appears once connect_db has answered.
  await page.waitForSelector('[data-card-id="weapon-filter"] .wf-rack', { timeout: 60000 });
  // A few states on screen: kept, required, dropped, clutch, two weapons.
  for (const name of ["AK-47", "AWP"]) {
    await page.locator(`[data-card-id="weapon-filter"] button[aria-label="${name}"]`).first().click();
  }
  await press(page, "kill_mod_through_smoke");
  await press(page, "kill_mod_no_scope");
  await press(page, "kill_mod_ace_req");
  await press(page, "kill_mod_wall_bang_exclude");
  await press(page, "kill_mod_flick");
  await press(page, "clutch_enabled");
  await press(page, "clutch_1v2");
  await press(page, "clutch_1v3");
  await press(page, "dmg_mod_big_hit");
  await press(page, "shot_mod_knife_swing_exclude");
  for (const style of STYLES) {
    await chooseStyle(page, style);
    for (const { id, file } of CARDS) await shootCard(page, id, `${file}-${style}`);
    if (style === "sentence") {
      await page.locator('[data-card-id="kill-filters"] button[aria-label="FLICK"]').first().click();
      await page.waitForTimeout(300);
      await shootCard(page, "kill-filters", "kill-filters-sentence-open");
      await page.keyboard.press("Escape");
    }
  }
  await chooseStyle(page, "timeline");
} finally {
  await close();
}
