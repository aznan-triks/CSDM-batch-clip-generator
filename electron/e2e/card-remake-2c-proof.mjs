/**
 * Card remake 2c (TAGS and SETTINGS cards) -- each card in each style (§1 P8).
 *
 * Headless chromium with a stubbed `window.bridge` (no window on screen, no
 * engine, no database): `load_config` answers DEFAULT_CONFIG itself, so every
 * card sits in its reference slot. Each style is chosen the way a user does:
 * Settings > UI Theme > Per-card style. Prints each card's overflow in rows,
 * which is what sizes `ui_sections.tags` / `.settings` in DEFAULT_CONFIG.
 * Output: electron/e2e/output/feat/remake-2c-tags-settings/<card>-<style>.png.
 *
 * Usage: node e2e/card-remake-2c-proof.mjs [card-id,card-id…]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const outDir = path.join(SHOT_DIR, "feat", "remake-2c-tags-settings");
mkdirSync(outDir, { recursive: true });

const REPO = path.resolve(ELECTRON_DIR, "..");
const DEFAULTS = execFileSync("python", ["-X", "utf8", "-c", "import json;from csdm.config import DEFAULT_CONFIG as d;print(json.dumps(d))"], {
  cwd: REPO,
  encoding: "utf8",
});
const DESCRIBE = JSON.parse(readFileSync(path.join(ELECTRON_DIR, "e2e", "stub-describe.json"), "utf-8"));
DESCRIBE.preset_categories = DESCRIBE.preset_categories ?? ["full", "date", "players", "video"];

const CONFIG_OVERRIDES = { theme_bg: "white", theme_accent: "blue", ui_active_tags: [1, 3] };
const TAGS = [
  [1, "Aces", "#ef4444"],
  [2, "Clutch", "#3b82f6"],
  [3, "Highlights", "#22c55e"],
  [4, "Scrims", "#eab308"],
  [5, "To review", "#8b5cf6"],
];

const STUB = `(() => {
  const listeners = [];
  const config = Object.assign(${DEFAULTS}, ${JSON.stringify(CONFIG_OVERRIDES)});
  const COMMANDS = {
    load_config: config,
    connect_db: { ok: true, weapons: [], maps: [], players: [], tags: ${JSON.stringify(TAGS)} },
    describe_filters: ${JSON.stringify(DESCRIBE)},
    list_presets: { "Night scrims": { cats: ["date", "players"], data: {} }, "Full backup": { cats: ["full"], data: {} } },
    probe_config_dir: { current: "C:\\\\Tools\\\\CSDM Batch Clip Generator", target: "", conflicts: [], same: true, kind: "app" },
    tags_calc_range: { date_start: "2024-02-11", date_end: "2024-09-03", date_after: "2024-09-04", demo_count: 42 },
    tags_search: { demos: [
      { path: "a", name: "faceit-2024-09-01-mirage.dem", n_events: 4, n_seq: 2 },
      { path: "b", name: "premier-2024-08-28-inferno.dem", n_events: 2, n_seq: 1 },
      { path: "c", name: "scrim-2024-08-20-nuke.dem", n_events: 6, n_seq: 3 }
    ] },
  };
  window.bridge = {
    send(command) {
      if (command && command.type === "command") {
        const data = COMMANDS[command.name] !== undefined ? COMMANDS[command.name] : {};
        setTimeout(() => { for (const l of listeners) l({ type: "result", id: command.id, ok: true, data }); }, 10);
      }
    },
    onMessage(cb) { listeners.push(cb); return () => {}; },
    pickPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    restartEngine: () => Promise.resolve(),
    onFlushRequest: () => () => {},
    setWindowBounds: () => Promise.resolve(),
  };
})();`;

const CARDS = {
  "tag-grid": ["TAGS", "Tags"],
  "tag-range": ["TAGS", "Tag Range"],
  operations: ["TAGS", "Operations"],
  postgresql: ["SETTINGS", "PostgreSQL Connection"],
  paths: ["SETTINGS", "Paths"],
  "config-folder": ["SETTINGS", "Configuration Folder"],
  presets: ["SETTINGS", "Presets"],
  "ui-theme": ["SETTINGS", "UI Theme"],
  "ui-layout": ["SETTINGS", "UI Layout"],
  performance: ["SETTINGS", "Performance"],
  "injection-preview": ["SETTINGS", "Injection Preview"],
};
const WANTED = process.argv[2] ? process.argv[2].split(",") : Object.keys(CARDS);
const STYLES = ["timeline", "sentence", "tiles"];
const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts"), server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("CONSOLE", m.text());
});
await page.addInitScript(STUB);

async function settle() {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(250);
}

async function openTab(name) {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.waitForSelector(`${CARD_ITEMS} .sh`, { timeout: 10000 });
  await page.waitForTimeout(300);
}

function card(title) {
  return page.locator(CARD_ITEMS).filter({ has: page.locator(".sh .t").getByText(title, { exact: true }) }).first();
}

async function measure(locator) {
  return locator.evaluate((node) => {
    const css = getComputedStyle(document.documentElement);
    const row = parseFloat(css.getPropertyValue("--block-row")) || 24;
    const gap = parseFloat(css.getPropertyValue("--block-gap")) || 0;
    const body = node.querySelector(".sb-scroll") ?? node.querySelector(".sb");
    const need = body ? body.scrollHeight - body.clientHeight : 0;
    const wide = body ? body.scrollWidth - body.clientWidth : 0;
    return { slotPx: Math.round(node.getBoundingClientRect().height), overflowPx: need, extraRows: Math.ceil(need / (row + gap)), hOverflowPx: wide };
  });
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
  for (const id of WANTED) {
    const [tab, title] = CARDS[id];
    for (const style of STYLES) {
      await openTab("SETTINGS");
      await page.locator(`#cso-${id}`).selectOption(style);
      await openTab(tab);
      const c = card(title);
      await c.scrollIntoViewIfNeeded();
      if (id === "tag-range") await c.locator('[data-action="I7"]').click();
      if (id === "operations") await c.locator('[data-action="I6"]').click();
      await settle();
      const file = path.join(outDir, `${id}-${style}.png`);
      await c.screenshot({ path: file });
      console.log(file, JSON.stringify(await measure(c)));
    }
  }
  for (const tab of ["TAGS", "SETTINGS"]) {
    await openTab(tab);
    await settle();
    const file = path.join(outDir, `tab-${tab.toLowerCase()}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
  await server.close();
}
