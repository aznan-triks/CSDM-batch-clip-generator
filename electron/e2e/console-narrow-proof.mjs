/**
 * Narrow-window console proof (2026-08-07).
 *
 * Bug: below 1000px the console was `display:none` (D24 predates the
 * resizable split) -- between 900 and 1000px there was NO console and no way
 * to reopen it, while the console is the only record of a run.
 *
 * Fix: the console stacks BELOW the workspace as a bounded second row
 * (AppShell.css `@media (max-width: 1000px)`), and returns to the right-hand
 * column when the window regains width. Never hidden, never unmounted.
 *
 * This script proves the behavior in the real Electron window:
 *  - at 1600x900: console is a right-hand column (x > workspace x);
 *  - at 900x640: console is BELOW the workspace (y > workspace bottom) and
 *    visible (not display:none), with a bounded height so the log scrolls;
 *  - back at 1600x900: console returns to the right-hand column.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { launchApp, shoot } from "./harness.mjs";
import { SHOT_DIR } from "./config.mjs";

function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
    };
  }, selector);
}

const report = [];
async function measure(page, label, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(400);
  const ws = await rectOf(page, ".scrollwrap");
  const consoleEl = await rectOf(page, ".console");
  const handle = await rectOf(page, ".split-handle");
  report.push({
    label,
    viewport,
    workspace: ws,
    console: consoleEl,
    handle,
    stacked: ws && consoleEl ? consoleEl.y >= ws.y + ws.h : null,
    sideBySide: ws && consoleEl ? consoleEl.x >= ws.x + ws.w : null,
  });
}

const session = await launchApp();
try {
  await measure(session.page, "wide-1600", { width: 1600, height: 900 });
  await shoot(session.page, "console-narrow-1600");
  await measure(session.page, "narrow-900", { width: 900, height: 640 });
  await shoot(session.page, "console-narrow-900");
  await measure(session.page, "wide-again-1600", { width: 1600, height: 900 });
} finally {
  await session.close();
}

mkdirSync(SHOT_DIR, { recursive: true });
const out = path.join(SHOT_DIR, "console-narrow-report.json");
const { writeFileSync } = await import("node:fs");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(report.map((r) => `${r.label}: console=${JSON.stringify(r.console)} stacked=${r.stacked} sideBySide=${r.sideBySide}`).join("\n"));
console.log("report:", out);
