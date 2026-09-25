/**
 * Round-2 UI proof, hidden window, real engine, isolated profile.
 *
 * Captures into output/round2-ui/<label>-*.png and notes.txt:
 *  - the SETTINGS > PostgreSQL card at the reference layout (does it scroll?),
 *  - how many times the engine banner reached the console (StrictMode dev),
 *  - RUN / PREVIEW state and tip on a fresh profile (no player picked).
 *
 * Isolation (context_guide §1 P11): refuses to run outside a worktree, and
 * points LOCALAPPDATA at a throwaway folder.
 * Usage: node e2e/round2-ui-proof.mjs <label>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT, SHOT_DIR } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

if (!REPO_ROOT.replace(/\\/g, "/").includes("/.claude/worktrees/")) {
  throw new Error(`${REPO_ROOT} is not a worktree: a real-engine run needs an isolated profile`);
}
if (fs.existsSync(path.join(REPO_ROOT, "csdm_config.json"))) {
  throw new Error("a flat csdm_config.json sits at the repo root -- this is not an isolated worktree");
}
const label = process.argv[2] ?? "run";
const OUT = path.join(SHOT_DIR, "round2-ui");
fs.mkdirSync(OUT, { recursive: true });
process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "csdm-round2-"));

const { page, close } = await launchWithEngine();
const notes = [];
const openTab = (name) => page.locator('[role="tab"]', { hasText: name }).first().click();

try {
  notes.push(`engine ready: ${await waitForEngine(page, 60000)}`);
  await page.waitForTimeout(2500);
  const consoleText = await page.locator(".console .body").innerText().catch(() => "");
  notes.push(`"engine ready" lines in console: ${(consoleText.match(/engine ready/g) ?? []).length}`);

  for (const [name, action] of [["PREVIEW", "A2"], ["RUN", "A1"]]) {
    const button = page.locator(`[data-action="${action}"]`).first();
    notes.push(`${name} disabled=${await button.isDisabled()} title=${await button.getAttribute("title")}`);
  }
  await page.locator(".actbar").first().screenshot({ path: path.join(OUT, `${label}-actbar.png`) });

  await openTab("SETTINGS");
  // The window's default size first, then narrower panes, where the
  // card's fields and help line wrap.
  for (const width of [0, 1280, 1100]) {
    if (width) await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(1200);
    const card = page.locator('[data-card-id="postgresql"]').first();
    const box = await card.evaluate((node) => {
      const scroller = node.querySelector(".sb-scroll");
      return {
        paneWidth: node.offsetWidth,
        cardHeight: node.offsetHeight,
        scrollHeight: scroller?.scrollHeight,
        clientHeight: scroller?.clientHeight,
      };
    });
    notes.push(`postgresql card @${width || "default"}: ${JSON.stringify(box)} scrolls=${box.scrollHeight > box.clientHeight}`);
    await card.screenshot({ path: path.join(OUT, `${label}-postgresql-card-${width || "default"}.png`) });
  }
} finally {
  fs.writeFileSync(path.join(OUT, `${label}-notes.txt`), notes.join("\n"), "utf8");
  console.log(notes.join("\n"));
  await close();
}
