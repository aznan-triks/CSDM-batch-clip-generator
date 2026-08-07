// Evidence probe (2026-08-07): three UI reports at once.
//  A) Configuration Folder Location chips never show a selected state
//  B) text inputs do not adapt to dark/light themes
//  C) console buttons overflow when the window is narrow (+ global overflow sweep)
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

// ---------- A) folder chips selected state ----------
await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
await page.waitForTimeout(300);
await settle();
const chipState = await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".settings-folder .row button.chip")];
  return btns.map((b) => ({ text: b.textContent.trim(), on: b.classList.contains("on"), disabled: b.disabled }));
});
console.log("A) folder chips:", JSON.stringify(chipState));

// ---------- B) inputs in light vs dark ----------
async function inputStyles() {
  return page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, border: s.borderColor, caret: s.caretColor, colorScheme: s.colorScheme };
    };
    const html = getComputedStyle(document.documentElement);
    return {
      htmlColorScheme: html.colorScheme,
      htmlBg: html.backgroundColor,
      fld: pick(".fld"),
      searchInput: pick(".log-search input"),
      selectFld: pick("select.fld"),
      dateField: pick(".date-field-text"),
    };
  });
}
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "light");
  document.documentElement.setAttribute("data-ground", "white");
});
await settle();
const light = await inputStyles();
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "dark");
  document.documentElement.setAttribute("data-ground", "dark");
});
await settle();
const dark = await inputStyles();
console.log("B) light:", JSON.stringify(light, null, 1));
console.log("B) dark:", JSON.stringify(dark, null, 1));

// ---- B2) selects (VIDEO tab), date fields (CAPTURE tab), placeholders ----
const extra = await page.evaluate(() => {
  const mode = document.documentElement.getAttribute("data-mode");
  const pick = (sel, pseudo) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const ph = pseudo ? getComputedStyle(el, pseudo) : null;
    return {
      bg: s.backgroundColor, color: s.color, border: s.borderColor,
      colorScheme: s.colorScheme,
      placeholder: ph ? ph.color : null,
    };
  };
  return {
    mode,
    selectFld: pick("select.fld"),
    dateFieldText: pick(".date-field-text"),
    dateFieldNative: pick(".date-field-native"),
    placeholderFld: pick(".fld", "::placeholder"),
    placeholderSearch: pick(".log-search input", "::placeholder"),
    htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
  };
});
console.log(`B2) mode=${extra.mode}:`, JSON.stringify(extra));

await page.getByRole("tab", { name: "VIDEO", exact: true }).click();
await page.waitForTimeout(300);
await settle();
const videoSelects = await page.evaluate(() => {
  return [...document.querySelectorAll("select.fld")].map((el) => {
    const s = getComputedStyle(el);
    return { id: el.id, bg: s.backgroundColor, color: s.color, colorScheme: s.colorScheme };
  });
});
console.log(`B2) VIDEO selects (mode=${await page.evaluate(() => document.documentElement.getAttribute("data-mode"))}):`, JSON.stringify(videoSelects));

// ---- screenshots for the user (pre-fix evidence) ----
const shot = async (name) => {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (_) {} } });
  await page.screenshot({ path: `e2e/output/pre-${name}.png` });
  console.log(`SHOT pre-${name}.png`);
};
await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "light");
  document.documentElement.setAttribute("data-ground", "white");
});
await settle();
await shot("settings-light");
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "dark");
  document.documentElement.setAttribute("data-ground", "dark");
});
await settle();
await shot("settings-dark");
await page.getByRole("tab", { name: "VIDEO", exact: true }).click();
await page.waitForTimeout(300);
await settle();
await shot("video-dark");
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "light");
  document.documentElement.setAttribute("data-ground", "white");
});
await settle();
await shot("video-light");
await page.setViewportSize({ width: 1280, height: 700 });
await page.waitForTimeout(300);
await settle();
await shot("narrow-1280-dark");
await page.setViewportSize({ width: 900, height: 640 });
await page.waitForTimeout(300);
await settle();
await shot("min-900-dark");

// ---- cropped JPEGs of the fixed regions (vision workflow: PNG full-page is
//      rejected by the external vision model, JPEG crops are not) ----
const jshot = async (name, locator, opts = {}) => {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (_) {} } });
  const el = page.locator(locator).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await el.screenshot({ path: `e2e/output/${name}.jpg`, type: "jpeg", quality: 82, ...opts });
  console.log(`JSHOT ${name}.jpg`);
};
await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "dark");
  document.documentElement.setAttribute("data-ground", "dark");
});
await settle();
await jshot("crop-folder-dark", ".settings-folder");
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "light");
  document.documentElement.setAttribute("data-ground", "white");
});
await settle();
await jshot("crop-folder-light", ".settings-folder");
await page.getByRole("tab", { name: "VIDEO", exact: true }).click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.documentElement.setAttribute("data-mode", "dark");
  document.documentElement.setAttribute("data-ground", "dark");
});
await settle();
await jshot("crop-video-selects-dark", ".sec", {});
await page.setViewportSize({ width: 1280, height: 700 });
await page.waitForTimeout(300);
await settle();
await jshot("crop-console-tools-1280", ".console .ch");

// ---------- C) overflow sweep at several widths ----------
const report = [];
for (const width of [1600, 1280, 1000, 900, 800]) {
  await page.setViewportSize({ width, height: 700 });
  await page.waitForTimeout(250);
  await settle();
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && (el.classList.contains("amb") || el.closest(".amb"))) continue;
      // Inside a scrollable strip (`.tabs` overflow-x: auto), content past the
      // viewport edge is CLIPPED by the container -- not a page overflow.
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflowX === "hidden") {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const right = r.right - vw;
      const left = r.left;
      if (right > 1 || left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 80),
          left: Math.round(left), right: Math.round(r.right), vw,
          overflowRight: Math.round(right), overflowLeft: Math.round(-left),
        });
      }
    }
    return offenders.slice(0, 25);
  });
  report.push({ width, overflowCount: over.length, first: over.slice(0, 12) });

  // console tools specifics
  const consoleDetail = await page.evaluate(() => {
    const ch = document.querySelector(".console .ch");
    const tools = document.querySelector(".console .tools");
    if (!ch || !tools) return null;
    const cr = ch.getBoundingClientRect();
    const tr = tools.getBoundingClientRect();
    const children = [...tools.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { cls: (c.className || "").toString().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    });
    const searchInput = document.querySelector(".log-search input");
    const si = searchInput ? searchInput.getBoundingClientRect() : null;
    return {
      chW: Math.round(cr.width), toolsRight: Math.round(tr.right), chRight: Math.round(cr.right),
      toolsBeyond: Math.round(tr.right - cr.right),
      searchW: si ? Math.round(si.width) : null,
      children,
    };
  });
  console.log(`C) width=${width} console:`, JSON.stringify(consoleDetail));
}
console.log("C) sweep:", JSON.stringify(report, null, 1));

await browser.close();
await server.close();
