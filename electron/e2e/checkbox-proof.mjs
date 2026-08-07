// Visual proof: checkboxes now follow the window's language (2026-08-07).
//  A) "Auto-tag on export" is a toggle chip like every other boolean
//  B) CS2 EFFECTS and HLAE OPTIONS toggles are toggle chips too
//  C) found-demo rows use a restyled native checkbox
// Standalone chromium + stubbed window.bridge (recipe: csdm-e2e-visual-proof
// references/bridge-stub-visual-proof.md). NOT part of the Playwright suite.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ELECTRON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESCRIBE = readFileSync(path.join(ELECTRON_DIR, "e2e", "stub-describe.json"), "utf-8");

const STUB = `(() => {
  const listeners = [];
  const respond = (id, data) => {
    setTimeout(() => { for (const l of listeners) l({ type: "result", id, ok: true, data }); }, 10);
  };
  const COMMANDS = {
    load_config: {
      theme_bg: "dark", theme_accent: "green", config_dir: "",
      pg_host: "127.0.0.1", pg_port: "5432", pg_user: "postgres", pg_pass: "", pg_db: "csdm",
      csdm_exe: "C:/csdm/csdm.CMD", cs2_cfg_dir: "", output_dir_clips: "", output_dir_concat: "",
      output_dir_assembled: "", subfolder_per_demo: true, dp2_threads: 4,
      ui_window_w: 1600, ui_window_h: 900, ui_split_pct: 60, ui_remember_layout: true,
      video_codec: "libx264", audio_codec: "libmp3lame", crf: 18, video_preset: "medium",
      video_container: "mp4", recsys: "HLAE", encoder: "FFmpeg",
      tag_enabled: false, tag_on_export: "",
      phys_ragdoll_enable: true, phys_blood: true, phys_dynamic_lighting: false,
      hlae_afx_stream: false, hlae_no_spectator_ui: true, hlae_fix_scope_fov: true,
    },
    connect_db: {
      ok: true,
      weapons: [], maps: [], players: [], tags: [
        [1, "clip-worthy", "#f97316"],
        [2, "highlight", "#38bdf8"],
      ],
    },
    tags_search: {
      demos: [
        { path: "D:/demos/dust2_01.dem", name: "dust2_01.dem", n_events: 12, n_seq: 3 },
        { path: "D:/demos/mirage_07.dem", name: "mirage_07.dem", n_events: 8, n_seq: 2 },
        { path: "D:/demos/inferno_22.dem", name: "inferno_22.dem", n_events: 5, n_seq: 1 },
      ],
    },
    tags_set_active: { ok: true },
    probe_config_dir: {
      current: "C:/proj/CSDM-batch-clip_config",
      target: "C:/proj/CSDM-batch-clip_config",
      conflicts: [], same: true, kind: "app",
    },
    describe_filters: ${DESCRIBE},
  };
  window.bridge = {
    send(command) {
      if (command && command.type === "command") {
        respond(command.id, COMMANDS[command.name] !== undefined ? COMMANDS[command.name] : {});
      }
    },
    onMessage(cb) { listeners.push(cb); return () => {}; },
    pickPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    restartEngine: () => Promise.resolve(),
  };
})();`;

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error("vite did not report a local url");
console.log("vite:", url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(STUB);
await page.goto(url, { waitUntil: "networkidle" });

async function settle() {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { try { a.finish(); } catch (_) {} }
  });
}

const shot = async (name) => {
  await settle();
  await page.screenshot({ path: path.join(ELECTRON_DIR, "e2e", "output", `${name}.png`) });
  console.log(`SHOT e2e/output/${name}.png`);
};

// ---------- A) VIDEO tab: CS2 EFFECTS + HLAE OPTIONS chips ----------
await page.getByRole("tab", { name: "VIDEO", exact: true }).click();
await page.waitForTimeout(400);
await settle();

const videoChips = await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".cs2-effects .chip, .hlae-options .chip")];
  return chips.map((c) => ({
    text: c.textContent.trim(),
    on: c.classList.contains("on"),
    pressed: c.getAttribute("aria-pressed"),
  }));
});
console.log("A) video chips:", JSON.stringify(videoChips));
await shot("checkbox-proof-video");

// ---------- B) TAGS tab: Auto-tag chip + restyled found-demo checkboxes ----------
await page.getByRole("tab", { name: "TAGS", exact: true }).click();
await page.waitForTimeout(400);
await settle();

const autoTag = await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".tags-tab .chip")];
  const el = chips.find((c) => c.textContent.includes("Auto-tag"));
  if (!el) return null;
  const s = getComputedStyle(el);
  return {
    text: el.textContent.trim(),
    on: el.classList.contains("on"),
    pressed: el.getAttribute("aria-pressed"),
    bg: s.backgroundColor,
    border: s.borderColor,
  };
});
console.log("B) auto-tag chip:", JSON.stringify(autoTag));

// Select the first tag chip, then "By tag" to surface the found-demo rows.
await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".tags-tab .chips .chip")];
  const tag = chips.find((c) => c.textContent.includes("clip-worthy"));
  if (tag) tag.click();
});
await page.waitForTimeout(200);
await page.getByRole("button", { name: "By tag", exact: true }).click();
await page.waitForTimeout(400);
await settle();

const checks = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll(".tags-found-check")];
  return {
    count: boxes.length,
    styled: boxes.map((b) => {
      const s = getComputedStyle(b);
      return { appearance: s.appearance, border: s.borderColor, bg: s.backgroundColor, w: s.width };
    }),
  };
});
console.log("C) found-demo checkboxes:", JSON.stringify(checks));

// Check one box to show the checked face.
await page.evaluate(() => {
  const box = document.querySelector(".tags-found-check");
  if (box) box.click();
});
await page.waitForTimeout(200);
await settle();
await shot("checkbox-proof-tags");

await browser.close();
await server.close();
console.log("PROOF DONE");
