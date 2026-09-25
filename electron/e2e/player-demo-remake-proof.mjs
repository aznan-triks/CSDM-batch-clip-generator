/**
 * Player + Demo Selection remake -- each card in its three styles, shot from a
 * hidden window (§1 principle 8).
 *
 * No Python: the main process gets a stand-in answer for the four commands
 * these cards need (load_config, save_config, connect_db, list_demos), so the
 * cards draw a real-looking roster and demo list instead of "database
 * pending". The config is DEFAULT_CONFIG itself (read from Python once), so
 * every card sits in its reference slot; only the style and the card data are
 * set on top. Vite runs on its own port so a parallel proof cannot collide.
 *
 * Output: electron/e2e/output/card-remake-2a/<card>-<style>.png
 * Usage: node e2e/player-demo-remake-proof.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";

import { CONFIG, ELECTRON_DIR, REPO_ROOT, SHOT_DIR } from "./config.mjs";

const PORT = Number(process.env.PROOF_PORT ?? 5391);
const outDir = path.join(SHOT_DIR, "card-remake-2a");
mkdirSync(outDir, { recursive: true });

const DEFAULTS = JSON.parse(
  execFileSync("python", ["-c", "import json; from csdm.config import DEFAULT_CONFIG; print(json.dumps(DEFAULT_CONFIG))"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }),
);

const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const NAMES = ["s1mple", "ZywOo", "NiKo", "m0NESY", "donk", "ropz", "Twistzz", "sh1ro", "b1t", "jL", "frozen", "Spinx", "XANTARES", "broky"];
const PLAYERS = NAMES.map((name, i) => {
  const id = `7656119${String(8000000000 + i * 7919).padStart(10, "0")}`;
  return [`${name}  (${id})`, id, name, 1_700_000_000_000 - i * 86_400_000];
});
const DEMOS = Array.from({ length: 24 }, (_, i) => {
  const d = daysAgo(3 + i * 9);
  return {
    path: `D:/demos/match-${i}.dem`,
    name: `match-${i}.dem`,
    date: `${fmt(d)} 21:00`,
    map: ["mirage", "inferno", "nuke", "ancient"][i % 4],
    compat: { status: "ok", break: null, tip: null },
  };
});

const DATA = {
  config: {
    ...DEFAULTS,
    steam_ids: [PLAYERS[0][1], PLAYERS[2][1]],
    steam_id: PLAYERS[0][1],
    player_name: PLAYERS[0][2],
    saved_players: [PLAYERS[0], PLAYERS[1], PLAYERS[2], PLAYERS[4]].map((p) => ({ steam_id: p[1], name: p[2] })),
    date_from: fmt(daysAgo(30)),
    date_to: fmt(daysAgo(0)),
  },
  discovery: { weapons: [], maps: [], players: PLAYERS, tags: [] },
  demos: DEMOS,
};

const CARDS = [
  { id: "player", header: "player" },
  { id: "demo-selection", header: "demo selection" },
];
const STYLES = ["timeline", "sentence", "tiles"];
const CARD_ITEMS = '[role="tabpanel"]:not([hidden]) .react-grid-item';

const server = await createServer({
  configFile: path.join(ELECTRON_DIR, "vite.config.ts"),
  server: { port: PORT, strictPort: true },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: CONFIG.launchTimeoutMs,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine", CSDM_E2E_BACKGROUND: "1" },
});

try {
  // The stand-in engine: answers what the cards ask, drops the rest (as a dead engine would).
  await app.evaluate(({ ipcMain }, data) => {
    globalThis.__proofData = data;
    ipcMain.on("bridge:send", (event, cmd) => {
      if (!cmd || cmd.type !== "command") return;
      const d = globalThis.__proofData;
      const answers = {
        load_config: d.config,
        save_config: {},
        connect_db: d.discovery,
        list_demos: { demos: d.demos },
      };
      if (!(cmd.name in answers)) return;
      event.sender.send("bridge:message", { type: "result", id: cmd.id, ok: true, data: answers[cmd.name] });
    });
  }, DATA);

  const page = await app.firstWindow({ timeout: CONFIG.launchTimeoutMs });
  await page.setViewportSize(CONFIG.viewport);
  page.on("pageerror", (e) => console.error("PAGEERROR", e.message));

  for (const style of STYLES) {
    await app.evaluate((_, s) => {
      globalThis.__proofData.config.ui_card_style = s;
    }, style);
    await page.reload();
    await page.waitForSelector(`${CARD_ITEMS} .pc-${style}`, { timeout: 20000 });
    await page.waitForTimeout(800);
    for (const card of CARDS) {
      const index = await page.evaluate(
        ({ sel, header }) => {
          const items = [...document.querySelectorAll(sel)];
          const found = items.find((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes(header));
          found?.scrollIntoView({ block: "start" });
          return found ? items.indexOf(found) : -1;
        },
        { sel: CARD_ITEMS, header: card.header },
      );
      if (index < 0) throw new Error(`${card.id} card not found`);
      await page.evaluate(() => {
        for (const a of document.getAnimations()) {
          try { a.finish(); } catch (_) { /* infinite */ }
        }
      });
      await page.waitForTimeout(300);
      const item = page.locator(CARD_ITEMS).nth(index);
      // How tall the content wants to be, against the slot it got.
      const fit = await item.evaluate((node) => {
        const body = node.querySelector(".sb");
        return { slot: Math.round(node.getBoundingClientRect().height), content: body ? body.scrollHeight : null, visible: body ? body.clientHeight : null };
      });
      if (process.env.DIAG) {
        console.log(await item.evaluate((node) => {
          const chain = [];
          for (let el = node.querySelector(".ds-tiles, .ds-head, .pc-find"); el && el !== node; el = el.parentElement) {
            const cs = getComputedStyle(el);
            chain.push(`${el.className}|w=${Math.round(el.getBoundingClientRect().width)}|${cs.display}|gtc=${cs.gridTemplateColumns}|minw=${cs.minWidth}`);
          }
          return chain.join(" <- ");
        }));
      }
      const file = path.join(outDir, `${card.id}-${style}.png`);
      await item.screenshot({ path: file });
      console.log(file, JSON.stringify(fit));
    }
  }

  // The strip with a loaded demo list: Manual mode on, timeline style.
  await app.evaluate(() => {
    globalThis.__proofData.config.ui_card_style = "timeline";
  });
  await page.reload();
  await page.waitForSelector(`${CARD_ITEMS} .ds-timeline`, { timeout: 20000 });
  await page.getByRole("button", { name: /Manual mode/i }).first().click();
  await page.waitForTimeout(800);
  const demoCard = page.locator(CARD_ITEMS).filter({ has: page.locator(".ds-timeline") }).first();
  await demoCard.scrollIntoViewIfNeeded();
  const file = path.join(outDir, "demo-selection-timeline-manual.png");
  await demoCard.screenshot({ path: file });
  console.log(file);
} finally {
  await app.close();
  await server.close();
}
