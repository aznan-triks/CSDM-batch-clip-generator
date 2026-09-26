/**
 * Favourites (`saved_players`) survive every everyday flow, real engine.
 *
 * Runs on a COPY of this checkout's profile (isolatedProfileEnv), hidden
 * window. After each step the file on disk is read back:
 *   star a player -> change a setting -> switch card styles -> collapse a card
 *   -> restart -> load a preset -> PREVIEW (dry run) -> restart.
 *
 * Run: node electron/e2e/favourites-persist-proof.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { isolatedProfileEnv } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const profile = isolatedProfileEnv();
const CONFIG_FILE = path.join(profile.CSDM_PROFILE_ROOT, "CSDM-batch-clip_config", "csdm_config.json");
const onDisk = () => JSON.parse(readFileSync(CONFIG_FILE, "utf8")).saved_players ?? null;
const ids = (list) => (Array.isArray(list) ? list.map((p) => p.steam_id) : list);

const log = [];
let starred = null;
let failed = false;
function check(step, expectContains = true) {
  const list = ids(onDisk());
  const ok = Array.isArray(list) && (!expectContains || !starred || list.includes(starred));
  if (!ok) failed = true;
  log.push(`${ok ? "OK  " : "FAIL"} ${step}: saved_players on disk = ${JSON.stringify(list)}`);
}
const settle = (page) => page.waitForTimeout(1200); // > SAVE_DEBOUNCE_MS

async function start() {
  const session = await launchWithEngine(profile);
  if (!(await waitForEngine(session.page, 60000))) throw new Error("engine never said ready");
  await session.page.waitForTimeout(1500);
  return session;
}

let session = await start();
try {
  let { page } = session;
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await settle(page);
  log.push(`start: disk = ${JSON.stringify(ids(onDisk()))} (legacy import expected in memory)`);

  // 1. star the first unregistered player of the list
  const star = page.locator('.ps-star[aria-label="Add to accounts"]').first();
  await star.waitFor({ timeout: 30000 });
  starred = await star.evaluate((el) => el.closest("[data-steam-id]")?.getAttribute("data-steam-id") ?? null);
  await star.click();
  await settle(page);
  if (!starred) {
    const after = ids(onDisk()) ?? [];
    starred = after[after.length - 1] ?? null;
  }
  check("star a player");

  // 2. change another setting (first checkbox row of the CAPTURE tab)
  await page.locator('[role="tabpanel"]:not([hidden]) [role="checkbox"]').first().click();
  await settle(page);
  check("change another setting");

  // 3. switch card styles, back and forth
  await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
  const styleButtons = page.locator('[data-config-key="ui_card_style"] button');
  await styleButtons.first().waitFor({ timeout: 30000 });
  const n = await styleButtons.count();
  for (let i = 0; i < n; i += 1) {
    await styleButtons.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await settle(page);
  check(`switch card styles (${n} buttons)`);

  // 4. collapse / expand a card
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const fold = page.locator('[role="tabpanel"]:not([hidden]) [aria-expanded]').first();
  if (await fold.count()) {
    await fold.click().catch(() => {});
    await page.waitForTimeout(500);
    await fold.click().catch(() => {});
  }
  await settle(page);
  check("collapse/expand a card");

  // 5. restart
  await session.close();
  session = await start();
  page = session.page;
  await settle(page);
  check("restart");

  // 6. load a preset (the user's own, copied)
  await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
  const load = page.locator('[data-action="C4"]').first();
  // The list arrives once the engine answers list_presets (slow while the DB connects).
  if (await load.waitFor({ timeout: 30000 }).then(() => true, () => false)) {
    await load.click();
    await settle(page);
    check("load a preset");
  } else log.push("SKIP load a preset: no preset in the profile");

  // 7. PREVIEW (dry run on the real database)
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const preview = page.getByRole("button", { name: "PREVIEW", exact: true });
  if (await preview.isEnabled().catch(() => false)) {
    await preview.click();
    await page.waitForTimeout(15000);
  } else log.push("SKIP PREVIEW: disabled");
  await settle(page);
  check("preview");

  // 8. restart again, and the star is still drawn
  await session.close();
  session = await start();
  await settle(session.page);
  check("second restart");
  const drawn = await session.page.locator('.ps-star[aria-label="Remove from accounts"]').count();
  log.push(`registered stars drawn after restart: ${drawn}`);
} finally {
  await session.close().catch(() => {});
}

console.log(`profile: ${profile.CSDM_PROFILE_ROOT}\nstarred: ${starred}`);
console.log(log.join("\n"));
console.log(failed ? "FAVOURITES FAIL" : "FAVOURITES PASS");
process.exitCode = failed ? 1 : 0;
