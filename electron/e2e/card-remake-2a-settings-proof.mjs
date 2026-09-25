/**
 * Card remake 2a (Timing & Retries, Match Types, Map Filter) -- each card in
 * each style, and the Per-card style setting that switches them (§1 P8).
 *
 * Headless chromium with a stubbed `window.bridge` (no window on screen, no
 * engine, no database): `load_config` answers DEFAULT_CONFIG itself (so every
 * card sits in its reference slot), `connect_db` a small map pool. Each style
 * is chosen the way a user does it: Settings > UI Theme > Per-card style.
 * Output: electron/e2e/output/card-remake-2a/<card>-<style>.png.
 *
 * Usage: node e2e/card-remake-2a-settings-proof.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const outDir = path.join(SHOT_DIR, "card-remake-2a");
mkdirSync(outDir, { recursive: true });

const REPO = path.resolve(ELECTRON_DIR, "..");
const DEFAULTS = execFileSync("python", ["-X", "utf8", "-c", "import json;from csdm.config import DEFAULT_CONFIG as d;print(json.dumps(d))"], {
  cwd: REPO,
  encoding: "utf8",
});
const DESCRIBE = readFileSync(path.join(ELECTRON_DIR, "e2e", "stub-describe.json"), "utf-8");

const CONFIG_OVERRIDES = {
  theme_bg: "white",
  theme_accent: "blue",
  match_type_filter_enabled: true,
  match_type_premier: true,
  match_type_competitive: true,
  map_filter_enabled: true,
  map_filter: ["mirage", "inferno", "nuke"],
};
const MAPS = ["ancient", "anubis", "dust2", "inferno", "mirage", "nuke", "overpass", "train", "vertigo"].map((m) => [m, [`de_${m}`]]);

const STUB = `(() => {
  const listeners = [];
  const config = Object.assign(${DEFAULTS}, ${JSON.stringify(CONFIG_OVERRIDES)});
  const COMMANDS = {
    load_config: config,
    connect_db: { ok: true, weapons: [], maps: ${JSON.stringify(MAPS)}, players: [], tags: [] },
    describe_filters: ${DESCRIBE},
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

const CARDS = (process.argv[2] ?? "timing-retries,match-types,map-filter").split(",");
const TITLES = { "timing-retries": "Timing & Retries", "match-types": "Match Types", "map-filter": "Map Filter" };
const STYLES = ["timeline", "sentence", "tiles"];
const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

// Any free port: other proofs (and other worktrees) may hold the usual one.
const server = await createServer({
  configFile: path.join(ELECTRON_DIR, "vite.config.ts"),
  server: { port: 0, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
await page.addInitScript(STUB);

async function settle() {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { try { a.finish(); } catch (_) {} }
  });
  await page.waitForTimeout(250);
}

async function openTab(name) {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.waitForSelector(`${CARD_ITEMS} .sh`, { timeout: 10000 });
  await page.waitForTimeout(300);
}

function card(title) {
  return page.locator(CARD_ITEMS).filter({ has: page.locator(".sh", { hasText: title }) }).first();
}

/** The card's natural content height in grid rows, next to its slot. */
async function measure(locator) {
  return locator.evaluate((node) => {
    const css = getComputedStyle(document.documentElement);
    const row = parseFloat(css.getPropertyValue("--block-row")) || 24;
    const gap = parseFloat(css.getPropertyValue("--block-gap")) || 0;
    const body = node.querySelector(".sb");
    const need = body ? body.scrollHeight - body.clientHeight : 0;
    return { slotPx: node.getBoundingClientRect().height, overflowPx: need, extraRows: Math.ceil(need / (row + gap)) };
  });
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
  for (const id of CARDS) {
    for (const style of STYLES) {
      await openTab("SETTINGS");
      await page.getByLabel(TITLES[id], { exact: true }).selectOption(style);
      await openTab("CAPTURE");
      const c = card(TITLES[id]);
      await c.scrollIntoViewIfNeeded();
      await settle();
      const file = path.join(outDir, `${id}-${style}.png`);
      await c.screenshot({ path: file });
      console.log(file, JSON.stringify(await measure(c)));
    }
    // Open words, where the sentence style has popovers.
    await openTab("SETTINGS");
    await page.getByLabel(TITLES[id], { exact: true }).selectOption("sentence");
    await openTab("CAPTURE");
    const c = card(TITLES[id]);
    const token = c.locator('[aria-haspopup="dialog"]').first();
    if (await token.count()) {
      await c.scrollIntoViewIfNeeded();
      await token.click();
      await settle();
      const file = path.join(outDir, `${id}-sentence-open.png`);
      await c.screenshot({ path: file });
      console.log(file);
      await page.keyboard.press("Escape");
    }
  }
  await openTab("SETTINGS");
  const theme = card("UI Theme");
  await theme.scrollIntoViewIfNeeded();
  await settle();
  const themeFile = path.join(outDir, "settings-ui-theme.png");
  await theme.screenshot({ path: themeFile });
  console.log(themeFile, JSON.stringify(await measure(theme)));
} finally {
  await browser.close();
  await server.close();
}
