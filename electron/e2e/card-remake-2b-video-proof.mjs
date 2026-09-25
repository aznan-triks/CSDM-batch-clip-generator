/**
 * Card remake 2b (the seven VIDEO cards) -- each card in each style, its
 * overflow against its reference slot, one open sentence word, and the
 * whole tab per style (§1 P8).
 *
 * Headless chromium with a stubbed `window.bridge` (no window on screen, no
 * engine, no database): `load_config` answers DEFAULT_CONFIG itself (so every
 * card sits in its reference slot) with the global card style set per pass.
 * Output: electron/e2e/output/remake-2b-video/<card>-<style>.png.
 *
 * Usage: node e2e/card-remake-2b-video-proof.mjs [card-id,...]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const outDir = path.join(SHOT_DIR, "remake-2b-video");
mkdirSync(outDir, { recursive: true });

const REPO = path.resolve(ELECTRON_DIR, "..");
const DEFAULTS = execFileSync("python", ["-X", "utf8", "-c", "import json;from csdm.config import DEFAULT_CONFIG as d;print(json.dumps(d))"], {
  cwd: REPO,
  encoding: "utf8",
});
const DESCRIBE = readFileSync(path.join(ELECTRON_DIR, "e2e", "stub-describe.json"), "utf-8");

const TITLES = {
  "final-assembly": "Final Assembly",
  resolution: "Resolution, Framerate",
  "recording-system": "Recording System",
  "hlae-options": "HLAE Options",
  "in-game-options": "In-Game Options",
  "cs2-effects": "CS2 Effects",
  encoding: "Encoding",
};
const CARDS = (process.argv[2] ?? Object.keys(TITLES).join(",")).split(",");
const STYLES = ["timeline", "sentence", "tiles"];
const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

function stub(style) {
  const overrides = { theme_bg: "white", theme_accent: "blue", recsys: "HLAE", ui_card_style: style };
  return `(() => {
  const listeners = [];
  const config = Object.assign(${DEFAULTS}, ${JSON.stringify(overrides)});
  const COMMANDS = { load_config: config, connect_db: { ok: true, weapons: [], maps: [], players: [], tags: [] }, describe_filters: ${DESCRIBE} };
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
}

// Any free port: other proofs (and other worktrees) may hold the usual one.
const server = await createServer({
  configFile: path.join(ELECTRON_DIR, "vite.config.ts"),
  server: { port: 0, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const browser = await chromium.launch();

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(250);
}

/** The card's natural content height in grid rows, next to its slot. */
async function measure(locator) {
  return locator.evaluate((node) => {
    const css = getComputedStyle(document.documentElement);
    const row = parseFloat(css.getPropertyValue("--block-row")) || 24;
    const gap = parseFloat(css.getPropertyValue("--block-gap")) || 0;
    const body = node.querySelector(".sb");
    const need = body ? body.scrollHeight - body.clientHeight : 0;
    const wide = body ? body.scrollWidth - body.clientWidth : 0;
    return { slotPx: Math.round(node.getBoundingClientRect().height), overflowPx: need, extraRows: Math.ceil(need / (row + gap)), overflowXPx: wide };
  });
}

try {
  for (const style of STYLES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error("CONSOLE", m.text());
    });
    await page.addInitScript(stub(style));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
    await page.getByRole("tab", { name: "VIDEO", exact: true }).click();
    await page.waitForSelector(`${CARD_ITEMS} .sh`, { timeout: 10000 });
    await page.waitForTimeout(400);
    await settle(page);
    const tabFile = path.join(outDir, `tab-${style}.png`);
    await page.screenshot({ path: tabFile });
    console.log(tabFile);
    for (const id of CARDS) {
      const c = page.locator(CARD_ITEMS).filter({ has: page.locator(".sh", { hasText: TITLES[id] }) }).first();
      await c.scrollIntoViewIfNeeded();
      await settle(page);
      const file = path.join(outDir, `${id}-${style}.png`);
      await c.screenshot({ path: file });
      console.log(file, JSON.stringify(await measure(c)));
      if (style === "sentence") {
        const token = c.locator('[aria-haspopup="dialog"]').first();
        if (await token.count()) {
          await token.click();
          await settle(page);
          const open = path.join(outDir, `${id}-sentence-open.png`);
          await c.screenshot({ path: open });
          console.log(open);
          await page.keyboard.press("Escape");
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
