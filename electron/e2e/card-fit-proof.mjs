/**
 * Card fit -- does any card scroll, overlap a neighbour, or hold a box wider
 * than it was given? (§1 P8, fix/card-leftovers.)
 *
 * Headless chromium with a stubbed `window.bridge` (no window on screen, no
 * engine, no database): `load_config` answers DEFAULT_CONFIG itself, so every
 * card sits in its DEFAULT slot. For each window width × console split × card
 * style, every tab with a card grid is opened and each card reports:
 *
 *   - `scrollPx`: how far its body scrolls (the card is too short);
 *   - `overlaps`: the cards its box intersects (a broken default layout);
 *   - `wide`: descendants whose content is wider than their own box
 *     (scrollWidth > clientWidth), ellipsis truncations excepted.
 *
 * PostgreSQL is also measured after a FAILED Test & Reload -- the longest
 * answer it can show, with its guidance still beside it.
 * Output: electron/e2e/output/fix-card-leftovers/fit.json + one shot per tab
 * at 1600x900 in the default style.
 *
 *   - `emptyPx`: how much of its body sits empty below its content (the card
 *     is too tall -- fix/cards-fit-style).
 *
 * Usage: node e2e/card-fit-proof.mjs [--quick] [--out=<dir>]
 *   --quick: 1600x900 only; --out: folder under e2e/output (default fix-card-leftovers)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const OUT_ARG = process.argv.find((a) => a.startsWith("--out="));
const outDir = path.join(SHOT_DIR, OUT_ARG ? OUT_ARG.slice("--out=".length) : "fix-card-leftovers");
mkdirSync(outDir, { recursive: true });

const QUICK = process.argv.includes("--quick");
const WIDTHS = QUICK ? [1600] : [820, 980, 1180, 1440, 1600];
const SPLITS = QUICK ? [60] : [38, 60, 80];
const STYLES = ["timeline", "sentence", "tiles"];
// Below one fine row plus its gap, empty space is just the row rounding.
const EMPTY_TOLERANCE_PX = 34;
const TABS = ["CAPTURE", "VIDEO", "TAGS", "SETTINGS"];
const PG_ERROR =
  "PostgreSQL at localhost:5432 (database 'csdm') refused user 'postgres' with this password. Check User and Pass in SETTINGS › PostgreSQL Connection.";

const REPO = path.resolve(ELECTRON_DIR, "..");
const DEFAULTS = execFileSync("python", ["-X", "utf8", "-c", "import json;from csdm.config import DEFAULT_CONFIG as d;print(json.dumps(d))"], {
  cwd: REPO,
  encoding: "utf8",
});
const DESCRIBE = JSON.parse(readFileSync(path.join(ELECTRON_DIR, "e2e", "stub-describe.json"), "utf-8"));
DESCRIBE.preset_categories = DESCRIBE.preset_categories ?? ["full", "date", "players", "video"];

const DB = {
  weapons: ["ak47", "m4a1", "awp", "deagle", "usp_silencer", "glock"],
  maps: [
    ["Premier", ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis"]],
    ["Other", ["Deathrun_goldfever", "Pvpro_aim_m4a1_v2"]],
  ],
  players: [
    ["Trois (7656119…)", "76561198000000001", "Trois", "2026-09-20"],
    ["Mate (7656119…)", "76561198000000002", "Mate", "2026-09-18"],
  ],
  tags: [
    [1, "Aces", "#ef4444"],
    [2, "Clutch", "#3b82f6"],
    [3, "Highlights", "#22c55e"],
  ],
};

function stub(overrides) {
  return `(() => {
  const listeners = [];
  const config = Object.assign(${DEFAULTS}, ${JSON.stringify(overrides)});
  const COMMANDS = {
    load_config: config,
    connect_db: ${JSON.stringify(DB)},
    describe_filters: ${JSON.stringify(DESCRIBE)},
    list_presets: { "Night scrims": { cats: ["date", "players"], data: {} } },
    probe_config_dir: { current: "C:\\\\Tools\\\\CSDM Batch Clip Generator", target: "", conflicts: [], same: true, kind: "app" },
  };
  window.__pgFail = false;
  window.bridge = {
    send(command) {
      if (command && command.type === "command") {
        const fail = command.name === "connect_db" && window.__pgFail;
        const data = COMMANDS[command.name] !== undefined ? COMMANDS[command.name] : {};
        const reply = fail
          ? { type: "result", id: command.id, ok: false, error: ${JSON.stringify(PG_ERROR)} }
          : { type: "result", id: command.id, ok: true, data };
        setTimeout(() => { for (const l of listeners) l(reply); }, 10);
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

const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

/** Every card of the visible tab: its scroll, its overlaps, its too-wide boxes. */
function measureTab() {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  const rects = items.map((n) => n.getBoundingClientRect());
  return items.map((node, i) => {
    const title = node.querySelector(".sh .t")?.textContent ?? "?";
    const body = node.querySelector(".sb-scroll") ?? node.querySelector(".sb");
    const scrollPx = body ? body.scrollHeight - body.clientHeight : 0;
    // Empty space: the body's height minus where its last child ends. A
    // `display: contents` wrapper has no box: its children are measured.
    const boxes = (parent) =>
      [...parent.children].flatMap((c) => (getComputedStyle(c).display === "contents" ? boxes(c) : [c]));
    let emptyPx = 0;
    if (body && !node.querySelector(".sec.closed")) {
      const top = body.getBoundingClientRect().top - body.scrollTop;
      let bottom = 0;
      for (const child of boxes(body)) {
        bottom = Math.max(bottom, child.getBoundingClientRect().bottom - top + (parseFloat(getComputedStyle(child).marginBottom) || 0));
      }
      emptyPx = Math.max(0, Math.round(body.clientHeight - bottom - (parseFloat(getComputedStyle(body).paddingBottom) || 0)));
    }
    const overlaps = [];
    rects.forEach((r, j) => {
      if (j === i) return;
      const a = rects[i];
      const w = Math.min(a.right, r.right) - Math.max(a.left, r.left);
      const h = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (w > 1 && h > 1) overlaps.push(items[j].querySelector(".sh .t")?.textContent ?? "?");
    });
    const wide = [];
    for (const el of node.querySelectorAll(".sb *")) {
      if (el.closest("svg") || /^(INPUT|TEXTAREA|SELECT|svg)$/i.test(el.tagName)) continue;
      const over = el.scrollWidth - el.clientWidth;
      if (el.clientWidth === 0 || over <= 0) continue;
      const css = getComputedStyle(el);
      if (css.textOverflow === "ellipsis") continue;
      // A scroll container meant to scroll sideways (a table, a chip rail) is not a leak.
      if (css.overflowX === "auto" || css.overflowX === "scroll") continue;
      // Name the child that sticks out furthest: the box to fix, not its victim.
      const edge = el.getBoundingClientRect().right;
      let culprit = null;
      let furthest = 0;
      for (const child of el.querySelectorAll("*")) {
        const out = child.getBoundingClientRect().right - edge;
        if (out > furthest) [culprit, furthest] = [child, out];
      }
      const name = (n) => (n ? `${n.tagName.toLowerCase()}.${[...n.classList].join(".")}` : "");
      wide.push({ el: name(el), overPx: over, culprit: name(culprit), text: (el.textContent ?? "").slice(0, 24) });
    }
    // A body child that grows to fill the card has no natural height of its own.
    const fills = body ? [...body.children].filter((c) => parseFloat(getComputedStyle(c).flexGrow) > 0).map((c) => c.className) : [];
    return { card: title, scrollPx, emptyPx, fills, overlaps, wide };
  });
}

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts"), server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const browser = await chromium.launch();
const results = [];
const problems = [];

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(200);
}

async function openTab(page, name) {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.waitForSelector(`${CARD_ITEMS} .sh`, { timeout: 10000 });
  await page.waitForTimeout(250);
  await settle(page);
}

function record(where, rows) {
  for (const row of rows) {
    results.push({ ...where, ...row });
    if (row.scrollPx > 1 || row.overlaps.length || row.wide.length) problems.push({ ...where, ...row });
  }
}

try {
  for (const width of WIDTHS) {
    for (const split of SPLITS) {
      for (const style of STYLES) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
        await page.addInitScript(stub({ theme_bg: "white", theme_accent: "blue", ui_card_style: style, ui_split_pct: split }));
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForSelector(CARD_ITEMS, { timeout: 30000 });
        for (const tab of TABS) {
          await openTab(page, tab);
          record({ width, split, style, tab }, await page.evaluate(measureTab));
          if (width === 1600 && split === 60) {
            await page.screenshot({ path: path.join(outDir, `tab-${tab.toLowerCase()}-${style}.png`) });
            // Cards the tab shot cuts off, whole: Kill Filters (the tallest) and
            // Configuration Folder (its `cf-` prefix used to collide with the
            // filter cards'). A shot taller than the viewport comes back
            // garbled, so the viewport grows to hold the card for this one shot.
            const cardId = { CAPTURE: "kill-filters", SETTINGS: "config-folder" }[tab];
            if (cardId) {
              const card = page.locator(`[data-card-id="${cardId}"]`);
              const box = await card.boundingBox();
              await page.setViewportSize({ width, height: Math.max(900, Math.ceil(box.y + box.height + 400)) });
              await settle(page);
              await card.screenshot({ path: path.join(outDir, `${cardId}-${style}.png`) });
              await page.setViewportSize({ width, height: 900 });
              await settle(page);
            }
          }
        }
        // SETTINGS is open: fail a Test & Reload and measure PostgreSQL again.
        await page.evaluate(() => {
          window.__pgFail = true;
        });
        const pg = page.locator(CARD_ITEMS).filter({ has: page.locator(".sh .t").getByText("PostgreSQL Connection", { exact: true }) }).first();
        await pg.locator('[data-action="B1"]').click();
        await page.waitForSelector(".settings-db-status.st-bad");
        await settle(page);
        const rows = (await page.evaluate(measureTab)).filter((r) => r.card === "PostgreSQL Connection");
        record({ width, split, style, tab: "SETTINGS (pg failed)" }, rows);
        if (width === 1600 && split === 60) await pg.screenshot({ path: path.join(outDir, `postgresql-failed-${style}.png`) });
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(path.join(outDir, QUICK ? "fit-quick.json" : "fit.json"), JSON.stringify({ problems, results }, null, 1));
for (const p of problems) {
  const wide = p.wide.map((w) => `${w.el}+${w.overPx}${w.culprit ? `(${w.culprit})` : ""}`).join(" ");
  console.log(`${p.width}/${p.split}/${p.style} ${p.tab} › ${p.card}: scroll ${p.scrollPx}${p.overlaps.length ? ` overlaps ${p.overlaps}` : ""}${wide ? ` wide ${wide}` : ""}`);
}
console.log(`${problems.length} problem rows out of ${results.length}`);
// Per style: how much scrolls (too short) and how much sits empty (too tall).
for (const style of STYLES) {
  const rows = results.filter((r) => r.style === style && !r.tab.includes("pg failed"));
  const scroll = rows.filter((r) => r.scrollPx > 1);
  const empty = rows.filter((r) => r.emptyPx > EMPTY_TOLERANCE_PX);
  const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
  const max = (list, key) => Math.max(0, ...list.map((r) => r[key]));
  console.log(
    `${style}: ${scroll.length} scrolling (total ${sum(scroll, "scrollPx")} px, max ${max(scroll, "scrollPx")}); ` +
      `${empty.length} with >${EMPTY_TOLERANCE_PX} px empty (total ${sum(empty, "emptyPx")} px, max ${max(empty, "emptyPx")})`,
  );
}
