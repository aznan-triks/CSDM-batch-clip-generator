/**
 * Release smoke-proof: launch the PACKAGED portable exe exactly as the user
 * does, and assert the engine starts and the UI is live.
 *
 * This is what the unit suite cannot do: the NSIS stub unpacks to a temp dir,
 * so `process.execPath` points at the extraction, and the engine only starts
 * if `resolveRepoRoot()` anchors on `PORTABLE_EXECUTABLE_DIR` (v3.1.0 fix).
 * A green suite with a dead engine is exactly the trap this script exists to
 * catch before a release ships.
 *
 * Checks:
 *   1. the engine banner ("engine ready") appears in the console,
 *   2. the version chip in the top bar shows the packaged version,
 *   3. at 900px the console stacks BELOW the workspace (v3.0.9 fix), and
 *   4. zero horizontal overflow.
 *
 * Run: node electron/e2e/exe-smoke-proof.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const EXE = path.join(ELECTRON_DIR, "dist-app", "CSDM-Batch-Clips-Generator.exe");
const PORT = 9223;
const CDP = `http://localhost:${PORT}`;
const EXPECTED_VERSION = "3.1.0";

mkdirSync(SHOT_DIR, { recursive: true });

// 1. Launch the portable exe with a debugging port (the NSIS stub forwards args).
// Strip the agent's own PYTHONPATH/VIRTUAL_ENV: a double-click never has them,
// and they would let the engine borrow packages from a foreign venv and mask
// the real interpreter resolution the user gets.
const cleanEnv = { ...process.env };
delete cleanEnv.PYTHONPATH;
delete cleanEnv.VIRTUAL_ENV;
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  cwd: ELECTRON_DIR,
  detached: true,
  stdio: "ignore",
  env: cleanEnv,
});

// 2. Wait for the CDP endpoint.
let browser;
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(CDP);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!browser) throw new Error("CDP endpoint never came up");

  const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("index.html"));
  if (!page) throw new Error("renderer page not found");

  await page.waitForSelector(".brand-version", { timeout: 30000 });
  const chip = await page.locator(".brand-version").textContent();

  // Give the engine banner a moment to land in the console.
  await page.waitForTimeout(2000);
  const consoleText = (await page.locator(".console").textContent().catch(() => "")) ?? "";
  const engineReady = consoleText.includes("engine ready");
  const shownVersion = consoleText.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  console.log(`console snippet: ${JSON.stringify(consoleText.trim().slice(0, 400))}`);

  // The narrow-window proof: at the 900px minimum the console must STACK below
  // the workspace (v3.0.9), not sit beside it.
  await page.setViewportSize({ width: 900, height: 640 });
  await page.waitForTimeout(300);
  const at900 = await page.evaluate(() => {
    const wrap = document.querySelector(".scrollwrap");
    const consoleEl = document.querySelector(".console");
    const wr = wrap?.getBoundingClientRect();
    const cr = consoleEl?.getBoundingClientRect();
    return {
      stacked: Boolean(wr && cr && cr.top >= wr.bottom - 2),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  const hud = await page.locator(".hud-nav").screenshot({
    path: path.join(SHOT_DIR, "exe-smoke-hud.png"),
  });
  const full = await page.screenshot({ path: path.join(SHOT_DIR, "exe-smoke-full.png") });

  console.log(
    JSON.stringify(
      {
        chip,
        engineReady,
        shownVersion,
        stacked: at900.stacked,
        overflowX: at900.overflowX,
        hudBytes: hud.length,
        fullBytes: full.length,
      },
      null,
      2,
    ),
  );

  const ok =
    chip === EXPECTED_VERSION &&
    engineReady &&
    shownVersion === EXPECTED_VERSION &&
    at900.stacked &&
    at900.overflowX === 0;
  console.log(ok ? "SMOKE PASS" : "SMOKE FAIL");
  process.exitCode = ok ? 0 : 1;
} finally {
  try {
    await browser?.close();
  } catch {
    /* already gone */
  }
  spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}
