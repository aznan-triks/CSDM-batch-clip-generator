/**
 * EDITING SAVE proof (§1 principle 8): real engine, hidden window. A preview
 * is dispatched into the renderer's store (no database needed), one clip is
 * edited, SAVE is clicked, the name is typed into the console's question
 * panel, and the presets file the engine wrote is read back to show the
 * selection and its edits were stored.
 *
 * Isolation (context_guide §1 P11): the engine writes the worktree's own
 * CSDM-batch-clip_config/ (gitignored); LOCALAPPDATA points at a throwaway
 * folder. Refuses to run from a checkout with a flat csdm_config.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT, SHOT_DIR } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const OUT = path.join(SHOT_DIR, "editing-save");
fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(path.join(REPO_ROOT, "csdm_config.json"))) {
  throw new Error("a flat csdm_config.json sits at the repo root -- this is not an isolated worktree");
}
process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "csdm-editing-save-"));
const PRESET = "Clutch reel (proof)";

const { page, close } = await launchWithEngine();
try {
  if (!(await waitForEngine(page, 60000))) throw new Error("the engine never said it was ready");
  await page.evaluate(async () => {
    const TR = 64;
    const clip = (t, victims) => ({
      start_tick: t - 3 * TR,
      end_tick: t + (victims.length + 1) * TR,
      event_type: "kill",
      events: victims.map((v, i) => ({ tick: t + i * TR, type: "kill", victim_sid: v })),
      event_keys: victims.map((v, i) => `${t + i * TR}:kill:${v}`),
      camera_segments: [{ from_tick: t - 3 * TR, to_tick: t + (victims.length + 1) * TR, steam_id: "me", name: "zebi" }],
    });
    const store = await import("/src/motion/engineStore.ts");
    store.dispatchEngineMessage("preview_ready", {
      cfg: { tickrate: TR, player_name: "zebi" },
      sequences: {
        "D:/CS2/demos/2026-09-20_mirage_1001.dem": [clip(60 * TR, ["a", "b"]), clip(200 * TR, ["c"])],
        "D:/CS2/demos/2026-09-21_inferno_1002.dem": [clip(90 * TR, ["d", "e", "f"])],
      },
    });
    store.editClip(0, { beforeS: 6 });
    store.toggleClipEvent(0, `${60 * TR}:kill:a`);
    store.toggleClipSelection(1);
  });

  await page.getByRole("tab", { name: /editing/i }).click();
  await page.waitForTimeout(800);
  await page.locator('[data-action="Q2"]').click();
  const field = page.locator("#ask-panel input");
  await field.waitFor({ timeout: 10000 });
  await field.fill(PRESET);
  await page.screenshot({ path: path.join(OUT, "01-save-asks-the-name.png") });

  await page.locator("#ask-panel").getByRole("button", { name: "Save" }).click();
  await page.locator(".console .body").filter({ hasText: `Preset '${PRESET}' saved` }).first()
    .waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "02-saved-in-console.png") });

  const presetsFile = path.join(REPO_ROOT, "CSDM-batch-clip_config", "csdm_presets.json");
  const stored = JSON.parse(fs.readFileSync(presetsFile, "utf8"))[PRESET];
  console.log("stored cats:", JSON.stringify(stored.cats), "settings:", Object.keys(stored.data).length);
  console.log("stored selected_clips:", JSON.stringify(stored.selected_clips));
  console.log(`shots in ${OUT}`);
} finally {
  await close();
}
