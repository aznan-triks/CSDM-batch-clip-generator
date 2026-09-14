/**
 * Fix C visual proof (§1 principle 8): the KILL FILTERS card on the real
 * window no longer offers a TK choice, and the Event Type card still offers
 * Ally / Enemy -- photographed next to the approved mock at the same geometry.
 *
 * A passing unit test that finds no "TK" label proves the component, not the
 * window: this opens the window.
 */
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import { CONFIG, SHOT_DIR } from "./config.mjs";
// The engine, not the hermetic harness: KILL FILTERS builds its rows from the
// engine's `describe_filters`, so without a child it only ever says "Loading".
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const cardByTitle = (title) => (t) => {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  const card = items.find((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes(t));
  if (!card) return null;
  card.scrollIntoView({ block: "start" });
  return items.indexOf(card);
};

const { page, close } = await launchWithEngine();
if (!(await waitForEngine(page, 60000))) {
  await close();
  throw new Error("the engine never greeted -- there are no filter rows to photograph");
}
await page.waitForSelector(".kf-top-group", { timeout: 30000 });
await page.waitForTimeout(800);

const killIndex = await page.evaluate(cardByTitle(), "kill filters");
if (killIndex === null) {
  await close();
  throw new Error("KILL FILTERS card not found");
}
const facts = await page.evaluate((i) => {
  const card = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
  const labels = [...card.querySelectorAll(".kf-top-group .lab")].map((l) => l.textContent.trim());
  return {
    topGroupLabels: labels,
    teamkillsControl: !!document.querySelector('[data-config-key="teamkills_mode"]'),
    allyControl: !!document.querySelector('[data-config-key="event_ally"]'),
    enemyControl: !!document.querySelector('[data-config-key="event_enemy"]'),
  };
}, killIndex);
await page.waitForTimeout(400);
const killCard = page.locator('[role="tabpanel"]:not([hidden]) .react-grid-item').nth(killIndex);
await killCard.screenshot({ path: `${SHOT_DIR}/kill-filters-card.png` });

const eventIndex = await page.evaluate(cardByTitle(), "capture");
if (eventIndex !== null) {
  await page.waitForTimeout(400);
  await page.locator('[role="tabpanel"]:not([hidden]) .react-grid-item').nth(eventIndex)
    .screenshot({ path: `${SHOT_DIR}/capture-timing-card.png` });
}
await close();

// The approved mock, same viewport: its own Kill Filters card, for the side-by-side.
const browser = await chromium.launch();
const mock = await browser.newPage({ viewport: CONFIG.viewport });
await mock.goto(pathToFileURL(CONFIG.mockPath).href);
await mock.evaluate(() => {
  for (const a of document.getAnimations()) {
    try { a.finish(); } catch (_) { /* infinite effect */ }
  }
});
const mockCard = mock.locator(".sec", { has: mock.locator(".sh .t", { hasText: "Kill Filters" }) }).first();
if (await mockCard.count()) {
  await mockCard.scrollIntoViewIfNeeded();
  await mockCard.screenshot({ path: `${SHOT_DIR}/mock-v12-kill-filters-card.png` });
} else {
  await mock.screenshot({ path: `${SHOT_DIR}/mock-v12-kill-filters-card.png` });
}
await browser.close();

console.log(JSON.stringify(facts, null, 2));
const ok = !facts.teamkillsControl && !facts.topGroupLabels.includes("TK")
  && facts.allyControl && facts.enemyControl;
console.log(`VERDICT: no TK control = ${!facts.teamkillsControl}; Ally/Enemy present = ${facts.allyControl && facts.enemyControl}`);
console.log(`shots: ${SHOT_DIR}/kill-filters-card.png, capture-timing-card.png, mock-v12-kill-filters-card.png`);
process.exitCode = ok ? 0 : 1;
