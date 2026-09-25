/**
 * First-run walkthrough (audit axis E): a brand-new user, empty profile,
 * real engine, hidden window. Photographs each step into output/first-run/
 * and dumps what the console said, so a reviewer can read the journey
 * without opening the app.
 *
 * Isolation (context_guide §1 P11): refuses to start when the config
 * folder next to the code under test already exists, and points
 * LOCALAPPDATA at a throwaway folder so an "appdata" pointer can never
 * reach the machine's real profile. Never run from the main checkout.
 *
 * Optional: FIRST_RUN_PG_PORT forces an unused PostgreSQL port to show the
 * "database absent" path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT, SHOT_DIR } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const OUT = path.join(SHOT_DIR, "first-run");
fs.mkdirSync(OUT, { recursive: true });

const profileDir = path.join(REPO_ROOT, "CSDM-batch-clip_config");
if (fs.existsSync(profileDir) && process.env.FIRST_RUN_KEEP !== "1") {
  throw new Error(`${profileDir} exists -- delete it first, a first run needs an empty profile`);
}
if (fs.existsSync(path.join(REPO_ROOT, "csdm_config.json"))) {
  throw new Error("a flat csdm_config.json sits at the repo root -- this is not an isolated worktree");
}
process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "csdm-first-run-"));

const { page, close } = await launchWithEngine();
const notes = [];
const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};
const consoleText = () => page.locator(".console .body").innerText().catch(() => "");
const openTab = (label) => page.locator('[role="tab"]', { hasText: label }).first().click();

try {
  const ready = await waitForEngine(page, 60000);
  notes.push(`engine ready: ${ready}`);
  await page.waitForTimeout(2500);
  await shot("01-first-launch-capture");
  notes.push("--- console after launch ---", await consoleText());

  await openTab("SETTINGS");
  await shot("02-settings");
  if (process.env.FIRST_RUN_PG_PORT) {
    const port = page.locator('[data-config-key="pg_port"] input').first();
    await port.fill(process.env.FIRST_RUN_PG_PORT);
  }
  const test = page.getByRole("button", { name: /test/i }).first();
  if (await test.count()) {
    await test.click();
    await page.waitForTimeout(4000);
  }
  await shot("03-settings-after-test");
  notes.push("--- console after Test & Reload ---", await consoleText());

  await openTab("CAPTURE");
  await shot("04-capture-player");
  await page.locator('[data-action="A2"]').first().click().catch(() => {});
  await page.waitForTimeout(3000);
  await shot("05-after-preview-click");
  notes.push("--- console after PREVIEW ---", await consoleText());
  const dialog = await page.locator('[role="dialog"], [role="alertdialog"]').allInnerTexts();
  notes.push(`dialogs: ${JSON.stringify(dialog)}`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator('[role="dialog"] button, [role="alertdialog"] button').first().click().catch(() => {});

  await openTab("CAPTURE");
  const untested = page.locator(".filter-row-untested");
  notes.push(`untested markers: ${await untested.count()}`);
  for (let i = 0; i < (await untested.count()); i += 1) {
    const row = untested.nth(i).locator("xpath=ancestor::div[contains(@class,'filter-row')][1]");
    await row.scrollIntoViewIfNeeded();
    await row.screenshot({ path: path.join(OUT, `05b-untested-${i}.png`) });
    notes.push(`  ${await row.innerText()} | title=${await untested.nth(i).getAttribute("title")}`);
  }
  notes.push(`DB pill: ${await page.locator(".navtools .p").first().innerText()} | ${await page.locator(".navtools .p").first().getAttribute("title")}`);

  await openTab("VIDEO");
  await shot("06-video");
  await openTab("EDITING");
  await shot("07-editing-empty");
  const gen = page.locator('[data-action="Q1"]').first();
  notes.push(`GENERATE disabled=${await gen.isDisabled().catch(() => "?")} title=${await gen.getAttribute("title").catch(() => "?")}`);
} finally {
  fs.writeFileSync(path.join(OUT, "notes.txt"), notes.join("\n"), "utf8");
  await close();
}
