/**
 * Visual proof: the accent picker reaches --accent, not just --gold.
 *
 * Standalone chromium + stubbed window.bridge (same recipe as
 * checkbox-proof.mjs), theme_accent set to the exact value the reported bug
 * was seen with (green, #22C55E -- the live csdm_config.json at the time).
 * Before the fix, AppShell.css's active-tab underline, Card.css's hover
 * border/glitch gradient, and StatStrip.css's coloured figure all read
 * var(--accent), which tokens.css never bridged to --gold -- only
 * --accent-soft was. They stayed the mock's electric blue regardless of the
 * picker.
 */
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
      theme_bg: "white", theme_accent: "#22C55E", config_dir: "",
      pg_host: "127.0.0.1", pg_port: "5432", pg_user: "postgres", pg_pass: "", pg_db: "csdm",
      csdm_exe: "C:/csdm/csdm.CMD", cs2_cfg_dir: "", output_dir_clips: "", output_dir_concat: "",
      output_dir_assembled: "", subfolder_per_demo: true, dp2_threads: 4,
      ui_window_w: 1100, ui_window_h: 900, ui_split_pct: 60, ui_remember_layout: true,
      video_codec: "libx264", audio_codec: "libmp3lame", crf: 18, video_preset: "medium",
      video_container: "mp4", recsys: "HLAE", encoder: "FFmpeg",
      tag_enabled: false, tag_on_export: "",
      phys_ragdoll_enable: true, phys_blood: true, phys_dynamic_lighting: false,
      hlae_afx_stream: false, hlae_no_spectator_ui: true, hlae_fix_scope_fov: true,
    },
    connect_db: { ok: true, weapons: [], maps: [], players: [], tags: [] },
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.addInitScript(STUB);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

async function settle() {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch (_) {
        /* already finished */
      }
    }
  });
}

const shot = async (name) => {
  await settle();
  await page.screenshot({ path: path.join(ELECTRON_DIR, "e2e", "output", `${name}.png`) });
};

// Read the actual computed colours of the affected spots, plus the tokens
// themselves, so the screenshot has numbers to stand next to.
const report = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const tick = document.querySelector(".tab.active .tk"); // mock-v12.css: background: var(--accent)
  const statFigure = document.querySelector(".stc .v.a"); // StatStrip.css: color: var(--accent)
  return {
    tokens: { gold: root.getPropertyValue("--gold").trim(), accent: root.getPropertyValue("--accent").trim() },
    activeTabTick: tick ? getComputedStyle(tick).backgroundColor : "NOT FOUND",
    statFigureColor: statFigure ? getComputedStyle(statFigure).color : "NOT FOUND",
  };
});
console.log(JSON.stringify(report, null, 2));

await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
await page.waitForTimeout(400);
await shot("accent-bridge-capture");

const card = page.locator(".sec").first();
await card.hover();
await page.waitForTimeout(200);
// Card.css: `.sec:hover .cbr { border-color: var(--accent) }` -- the corner
// bracket SPAN, not `.sec` itself, is what actually carries the accent.
const bracketBorder = await card
  .locator(".cbr")
  .first()
  .evaluate((el) => getComputedStyle(el).borderColor);
console.log("corner bracket hover border-color:", bracketBorder);
await shot("accent-bridge-card-hover");

await browser.close();
await server.close();
