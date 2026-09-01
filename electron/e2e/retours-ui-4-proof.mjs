// Evidence probe (2026-09-02): the four reported UI items, measured.
//  1) the crosshair is replaced by the system cursor all over a card
//  2) the text boxes are ugly
//  3) text visibility per theme is bad
//  4) not enough card widths -- halve the grid
//
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
      theme_bg: "white", theme_accent: "green", config_dir: "appdata",
      pg_host: "127.0.0.1", pg_port: "5432", pg_user: "postgres", pg_pass: "", pg_db: "csdm",
      csdm_exe: "C:/csdm/csdm.CMD", cs2_cfg_dir: "", output_dir_clips: "", output_dir_concat: "",
      output_dir_assembled: "", subfolder_per_demo: true, dp2_threads: 4,
      ui_window_w: 1600, ui_window_h: 900, ui_split_pct: 60, ui_remember_layout: true,
      video_codec: "libx264", audio_codec: "libmp3lame", crf: 18, video_preset: "medium",
      video_container: "mp4",
    },
    probe_config_dir: {
      current: "C:\\\\Users\\\\Probe\\\\AppData\\\\Local\\\\CSDM-batch-clip_config",
      target: "C:\\\\Users\\\\Probe\\\\AppData\\\\Local\\\\CSDM-batch-clip_config",
      conflicts: [], same: true, kind: "appdata",
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

async function setGround(ground) {
  await page.evaluate((g) => {
    const root = document.documentElement;
    root.setAttribute("data-mode", g === "white" ? "light" : "dark");
    root.setAttribute("data-ground", g);
  }, ground);
  await settle();
}

const GROUNDS = ["white", "dark", "amoled", "deepblue", "terminal"];

function ratio(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---- 3) the mock's ink tokens, resolved per ground -------------------------
console.log("=== 3) TEXT VISIBILITY PER GROUND ===");
for (const ground of GROUNDS) {
  await setGround(ground);
  const read = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const px = (n) => cs.getPropertyValue(n).trim();
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolved = {};
    for (const name of ["--muted", "--faint", "--hair", "--border", "--panel", "--solid"]) {
      probe.style.color = `var(${name})`;
      resolved[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return { declared: { muted: px("--muted"), hair: px("--hair") }, resolved };
  });
  const r = read.resolved;
  console.log(
    ground.padEnd(9),
    "--muted", r["--muted"].padEnd(20),
    "on --panel", r["--panel"].padEnd(20),
    "=", ratio(r["--muted"], r["--panel"]).toFixed(2) + ":1",
  );
}

// ---- 2) the field's own states --------------------------------------------
console.log("");
console.log("=== 2) THE TEXT BOXES ===");
await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
await page.waitForTimeout(400);
for (const ground of ["white", "amoled"]) {
  await setGround(ground);
  const field = await page.evaluate(() => {
    const el = document.querySelector("input.fld");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lab = document.querySelector(".lab");
    return {
      tag: el.tagName,
      color: cs.color,
      background: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow.slice(0, 70),
      caret: cs.caretColor,
      label: lab ? { color: getComputedStyle(lab).color, weight: getComputedStyle(lab).fontWeight, size: getComputedStyle(lab).fontSize } : null,
    };
  });
  console.log(ground, JSON.stringify(field, null, 1));
}
// Every input on the page must wear the mock's field class.
const strays = await page.evaluate(() =>
  [...document.querySelectorAll('input[type="text"], input[type="password"], input[type="number"]')]
    .filter((el) => !el.classList.contains("fld") && !el.closest(".log-search"))
    .map((el) => el.className || "(no class)"),
);
console.log("inputs not wearing .fld:", JSON.stringify(strays));

// ---- 4) how many widths a card can take ------------------------------------
console.log("");
console.log("=== 4) CARD WIDTHS ===");
await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
await page.waitForTimeout(400);
const grid = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const block = parseInt(cs.getPropertyValue("--block"), 10);
  const gap = parseInt(cs.getPropertyValue("--block-gap"), 10);
  const pane = document.querySelector(".grid-pane");
  const width = pane ? pane.clientWidth : 0;
  return { block, gap, width, cols: Math.max(1, Math.floor((width + gap) / (block + gap))) };
});
console.log(JSON.stringify(grid), "->", grid.cols, "distinct widths a card can be dragged to");

// ---- 1) the crosshair ------------------------------------------------------
console.log("");
console.log("=== 1) THE CROSSHAIR ===");
const walk = await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  const inside = document.querySelectorAll(
    ".sec .lab, .sec .sh .t, .sec .gl, .sec .chip, .sec p, .sec span, .sec b, .sec svg",
  );
  for (const el of [...inside].slice(0, 40)) {
    const key = el.className && typeof el.className === "string" ? el.className : el.tagName;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    el.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    out.push([key.slice(0, 32), document.body.classList.contains("customcursor")]);
  }
  const natives = [];
  for (const sel of ["input.fld", ".tab", ".drag-handle", ".console .body"]) {
    const el = document.querySelector(sel);
    if (!el) { natives.push([sel, "absent"]); continue; }
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: r.left + Math.min(4, r.width / 2), clientY: r.top + Math.min(4, r.height / 2),
    }));
    natives.push([sel, document.body.classList.contains("customcursor")]);
  }
  return { inside: out, natives };
});
const off = walk.inside.filter(([, on]) => !on);
console.log("card insides walked:", walk.inside.length, "| crosshair OFF on:", JSON.stringify(off));
console.log("system-cursor surfaces (false = system cursor, correct):", JSON.stringify(walk.natives));

// ---- card inventory (regression check) -------------------------------------
console.log("");
console.log("=== CARDS PER TAB ===");
for (const tab of ["CAPTURE", "EDITING", "TAGS", "VIDEO", "SETTINGS"]) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(350);
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".grid-pane [data-card-id]")];
    return {
      n: cards.length,
      boxes: cards.map((c) => {
        const r = c.getBoundingClientRect();
        return [c.dataset.cardId, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      }),
    };
  });
  console.log(tab, info.n, JSON.stringify(info.boxes));
}

// ---- shots -----------------------------------------------------------------
for (const ground of GROUNDS) {
  await setGround(ground);
  await page.screenshot({ path: path.join(ELECTRON_DIR, "e2e", "output", `retours-4-${ground}.png`) });
}
await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
await page.waitForTimeout(400);
for (const ground of ["white", "amoled"]) {
  await setGround(ground);
  await page.screenshot({ path: path.join(ELECTRON_DIR, "e2e", "output", `retours-4-settings-${ground}.png`) });
}

await browser.close();
await server.close();
