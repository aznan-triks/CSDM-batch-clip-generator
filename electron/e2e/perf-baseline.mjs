/**
 * Performance/resource baseline for the packaged exe, run in a throwaway
 * worktree against an ISOLATED profile (real engine, real DB, read-only).
 *
 * Plan: docs/superpowers/plans/2026-09-23-audit-perf-ressources.md, Task 2 +
 * Task 3. Measures the 5 static suspects found in AUDIT_perf_ressources.md
 * ("Statique" section) with real numbers instead of confirming them by
 * reading code.
 *
 * ── Isolation (never touches the real profile) ──────────────────────────
 * `csdm/config.py::_repo_root()` and `electron/main.js::resolveRepoRoot()`
 * both honour `CSDM_REPO_ROOT`. Set to this worktree's root, EVERY config
 * file the engine reads or writes (CSDM-batch-clip_config/csdm_config.json)
 * lands inside the worktree, never beside the real checkout -- true even
 * without the override, since the packaged exe's own repo-root walk (from
 * `dist-app/` up to the nearest `csdm/bridge`) already lands inside this
 * worktree; the override just makes that explicit rather than incidental.
 * This script seeds that isolated file once, from a READ-ONLY copy of the
 * real csdm_config.json (DB credentials + player/date/filter defaults, so
 * PREVIEW behaves realistically) -- the real file is opened with
 * `fs.readFileSync` and never written. `verifyRealProfileUntouched()`
 * re-hashes both real profile files at the end and fails loudly if either
 * moved.
 *
 * PREVIEW is a dry run (no CS2, no recording) -- see engine-harness.mjs.
 *
 * ── How the exe is launched ──────────────────────────────────────────────
 * Same technique as `exe-smoke-proof.mjs`: plain `spawn()` +
 * `chromium.connectOverCDP()`, because the portable NSIS stub re-execs into
 * a temp dir and Playwright's own `_electron.launch()` tracking does not
 * survive that re-exec (confirmed by hand: it times out waiting for a first
 * window that already exists). This gives full CDP access to the renderer
 * (Performance, Emulation, Page domains) and to the Browser target (window
 * state, for minimize/restore) but NOT to Node in the Electron main process
 * -- `--inspect` was tried and rejected: the main process's default
 * execution context has no `require` and no registered dynamic-import
 * callback (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`), confirmed by probing
 * it directly, so there is no supported way to reach `BrowserWindow` from
 * there without Electron's undocumented `process._linkedBinding` internals
 * -- deliberately not used here.
 *
 * ── What this script can and cannot measure (read before trusting a number) ──
 *   - CDP `Performance.getMetrics` (Task/Script/Layout/RecalcStyle durations
 *     and counts) and JSHeapUsedSize: real, first-party CDP data.
 *   - "Is an animation loop running": a `requestAnimationFrame` CALL-COUNT
 *     spy installed on `window.requestAnimationFrame` after load. It counts
 *     every call made from that point on (Backdrop's loop re-arms itself by
 *     calling rAF again each frame, so a live loop shows a steady count and
 *     a stopped one shows zero) -- it does NOT itself schedule any frame, so
 *     it cannot manufacture the very activity it is measuring.
 *   - Window minimize/restore (I2): pure CDP `Browser.setWindowBounds`
 *     against the renderer's own target -- no Electron API needed.
 *   - CPU% and RSS: Windows `Win32_PerfFormattedData_PerfProc_Process`
 *     (PowerShell/CIM), one formatted snapshot per sample. Not a delta the
 *     script computes itself -- Windows already normalizes this class to a
 *     percentage, which is what the plan asks for, but it is a single
 *     instantaneous sample, not an integral over the window.
 *   - GPU engine utilization: Windows performance counter
 *     `\GPU Engine(*)\Utilization Percentage`, matched to a PID via the
 *     `pid_<n>_` prefix Windows puts on the instance name. If the counter
 *     set is unavailable on this machine, the script records
 *     `available: false` and says so -- it does not fabricate a number.
 *   - React re-render counts per component (I3/I4): NOT measured. A
 *     production build has no React Profiler hooks, and this script does not
 *     patch React internals to add one (that would change what is being
 *     measured). S2/S3 measure the OBSERVABLE cost instead (commit wall
 *     time via double-rAF, CDP Layout/RecalcStyle deltas), which is what a
 *     fix is actually judged on. Marked `not_measured` in the JSON output.
 *   - Bridge message count/bytes during PREVIEW (I8): measured exactly, at
 *     the renderer boundary. A CDP `Page.addScriptToEvaluateOnNewDocument`
 *     script wraps the preload's own `window.bridge.onMessage` (every
 *     message reaching it IS exactly what main sent -- wrapping here loses
 *     nothing a main-process wrap would have seen), installed once per
 *     launch via one `page.reload()` right after the engine banner, before
 *     any scenario runs. Counts and sizes EVERY message the callback
 *     receives, including `log` lines.
 *   - Demo count actually scanned by PREVIEW: read from the engine's own
 *     summary line ("`N clips … M demos`", `csdm/engine/core.py::_fmt_summary`),
 *     not assumed from the date-range boundary this script picked to reach
 *     roughly N -- the boundary is a DB-side estimate (see
 *     `computeDateBoundaries`), the summary line is the ground truth.
 *
 * Run: node electron/e2e/perf-baseline.mjs
 * Dry run (short windows, N=10 only, 1 run, proves wiring end to end):
 *   PERF_BASELINE_DRY_RUN=1 node electron/e2e/perf-baseline.mjs
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { ELECTRON_DIR, E2E_DIR, REPO_ROOT } from "./config.mjs";

// ═══════════════════════════════════════════════════════════════════════
//  Constants (Task 2: "tailles de jeu et durées de mesure = constantes")
// ═══════════════════════════════════════════════════════════════════════
const DRY_RUN = process.env.PERF_BASELINE_DRY_RUN === "1";

const DATASET_LABELS = DRY_RUN ? ["10"] : ["10", "100", "max"];
const IDLE_MS = DRY_RUN ? 3000 : 30000; // S1: 30s per tab at rest
const TAB_SWITCH_COUNT = DRY_RUN ? 3 : 20; // S2
const PREVIEW_REPEATS = DRY_RUN ? 1 : 3; // S3bis
const RUN_COUNT = DRY_RUN ? 1 : 2; // Task 2: "Exécuter 2 fois"
const PREVIEW_TIMEOUT_MS = DRY_RUN ? 60000 : 180000;
const LAUNCH_TIMEOUT_MS = 60000;

const TABS = ["capture", "editing", "tags", "video", "settings"];
const TAB_LABELS = { capture: "CAPTURE", editing: "EDITING", tags: "TAGS", video: "VIDEO", settings: "SETTINGS" };

const WORKTREE_ROOT = REPO_ROOT; // this script always runs from inside the throwaway worktree
const OUTPUT_DIR = path.join(E2E_DIR, "output");
// Redirects both perf-baseline.json/attribution.json and the reference
// screenshots into a subfolder (e.g. "perf-2/before-hidden") so before/after
// passes never overwrite each other. Default keeps the original flat layout.
const OUTPUT_SUBDIR = process.env.PERF_OUTPUT_SUBDIR || "";
const RUN_OUTPUT_DIR = OUTPUT_SUBDIR ? path.join(OUTPUT_DIR, OUTPUT_SUBDIR) : OUTPUT_DIR;
// Same "perf-reference" nesting whether or not PERF_OUTPUT_SUBDIR is set --
// screenshots always live one level under the JSON output, never flattened
// into it, so before/hidden/offscreen passes stay structurally identical.
const REFERENCE_DIR = path.join(RUN_OUTPUT_DIR, "perf-reference");
// PERF_EXE targets a frozen exe copy (e.g. exe-before/) instead of the
// worktree's own dist-app/ build, so a "before" measurement keeps working
// after the source tree has moved on to the "after" fix.
const EXE_PATH = process.env.PERF_EXE || path.join(ELECTRON_DIR, "dist-app", "CSDM-Batch-Clips-Generator.exe");

const CONFIG_SUBDIR = "CSDM-batch-clip_config"; // must mirror csdm/config.py::CONFIG_SUBDIR
const ISOLATED_CONFIG_DIR = path.join(WORKTREE_ROOT, CONFIG_SUBDIR);
const ISOLATED_CONFIG_FILE = path.join(ISOLATED_CONFIG_DIR, "csdm_config.json");

// ═══════════════════════════════════════════════════════════════════════
//  Real-profile isolation guard
// ═══════════════════════════════════════════════════════════════════════

/** The main checkout's root, found via git rather than hardcoded -- this
 * script only knows it is running inside SOME worktree of that checkout. */
function mainCheckoutRoot() {
  const gitCommonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: WORKTREE_ROOT, encoding: "utf8" },
  ).trim();
  return path.dirname(gitCommonDir); // <root>/.git -> <root>
}

// The two real-profile files this script must NEVER write to. Read-only.
function realProfilePaths() {
  const mainRoot = mainCheckoutRoot();
  return {
    root: mainRoot,
    csdmConfig: path.join(mainRoot, "csdm_config.json"),
    profileConfig: path.join(mainRoot, CONFIG_SUBDIR, "csdm_config.json"),
  };
}

function sha1(filePath) {
  const out = execFileSync("powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    `(Get-FileHash -Algorithm SHA1 -LiteralPath '${filePath}').Hash`,
  ], { encoding: "utf8" });
  return out.trim().toLowerCase();
}

function verifyRealProfileUntouched(before) {
  const after = {
    csdmConfig: sha1(before.paths.csdmConfig),
    profileConfig: sha1(before.paths.profileConfig),
  };
  const ok = after.csdmConfig === before.csdmConfig && after.profileConfig === before.profileConfig;
  return { ok, before, after };
}

// ═══════════════════════════════════════════════════════════════════════
//  Database (read-only). One python -c/psycopg2 subprocess per query --
//  same interpreter and credentials the engine itself uses.
// ═══════════════════════════════════════════════════════════════════════
function readRealDbCreds() {
  const real = realProfilePaths();
  const cfg = JSON.parse(readFileSync(real.csdmConfig, "utf8"));
  return {
    host: cfg.pg_host, port: String(cfg.pg_port), user: cfg.pg_user,
    pass: cfg.pg_pass, db: cfg.pg_db,
  };
}

function dbQueryJson(creds, sql) {
  const script = `
import psycopg2, json
conn = psycopg2.connect(host=${JSON.stringify(creds.host)}, port=${JSON.stringify(creds.port)}, user=${JSON.stringify(creds.user)}, password=${JSON.stringify(creds.pass)}, dbname=${JSON.stringify(creds.db)})
cur = conn.cursor()
cur.execute(${JSON.stringify(sql)})
rows = cur.fetchall()
print(json.dumps([[str(c) for c in r] for r in rows]))
cur.close(); conn.close()
`;
  const result = spawnSync("python", ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`DB query failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

/**
 * Per-demo dates exactly as the engine's date filter sees them, for the
 * seeded player's demos. The filter (`_query_events` ->
 * `_demo_passes_date_filter`) does NOT use any DB column: it reads the
 * demo's `.info` file, then falls back to the `.dem` file's mtime
 * (`EngineMixin._get_demo_ts`), and EXCLUDES a demo whose file is missing
 * once any bound is set. `demos.date` (the match date CSDM stored) is a
 * different clock, so boundaries computed from it do not select N demos.
 * This calls the engine's own two readers from this worktree's `csdm`
 * package (read-only: they only stat/read the demo files).
 */
function engineDemoDates(creds, steamIds) {
  const script = `
import json, sys, psycopg2
sys.path.insert(0, ${JSON.stringify(WORKTREE_ROOT)})
from csdm.engine.core import EngineMixin as E
conn = psycopg2.connect(host=${JSON.stringify(creds.host)}, port=${JSON.stringify(creds.port)}, user=${JSON.stringify(creds.user)}, password=${JSON.stringify(creds.pass)}, dbname=${JSON.stringify(creds.db)})
cur = conn.cursor()
cur.execute("SELECT DISTINCT m.demo_path FROM matches m JOIN players p ON p.match_checksum = m.checksum WHERE p.steam_id = ANY(%s)", (${JSON.stringify(steamIds)},))
paths = [r[0] for r in cur.fetchall() if r[0]]
cur.close(); conn.close()
out = []
for p in paths:
    ts = E._read_demo_date_from_info(p)
    if ts is None:
        ts = E._ts_from_demo_path(p)
    out.append(ts)
print(json.dumps(out))
`;
  const result = spawnSync("python", ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`engine demo dates failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

/** Local `yyyy-mm-dd` of a Unix timestamp -- the engine compares against
 * local midnight / 23:59:59 (`_qe_epoch_bounds`). */
function localIsoDate(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Date boundaries so PREVIEW's date range covers roughly N of the seeded
 * player's demos, for each requested label ("10", "100", "max"). "max" sets
 * no bound at all (every demo in the DB, file on disk or not). The others
 * count only demos the engine can date (see `engineDemoDates`), so they are
 * a close estimate, not exact: several demos can share the boundary day. The
 * engine's own result (clips/demos read from the live preview state) is the
 * ground truth, recorded separately per scenario.
 */
function computeDateBoundaries(creds, steamIds, labels) {
  const all = engineDemoDates(creds, steamIds);
  const dated = all.filter((ts) => typeof ts === "number").sort((a, b) => b - a);
  const total = all.length;
  const boundaries = {};
  for (const label of labels) {
    const n = Number(label);
    if (label === "max" || n >= dated.length) {
      boundaries[label] = { from: "", to: "", estimatedCount: total };
      continue;
    }
    const from = localIsoDate(dated[n - 1]);
    boundaries[label] = {
      from, to: localIsoDate(dated[0]),
      estimatedCount: dated.filter((ts) => localIsoDate(ts) >= from).length,
    };
  }
  return {
    total, datedOnDisk: dated.length,
    minDate: dated.length ? localIsoDate(dated[dated.length - 1]) : null,
    maxDate: dated.length ? localIsoDate(dated[0]) : null,
    boundaries,
  };
}

// dd-mm-yyyy, the format DemoSelectionSection's DateField actually uses.
function isoToDdMmYyyy(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Isolated profile seeding
// ═══════════════════════════════════════════════════════════════════════
function seedIsolatedProfile(realCfg) {
  mkdirSync(ISOLATED_CONFIG_DIR, { recursive: true });
  // Full copy of the real config (DB creds + player/date/filter defaults),
  // written ONLY inside the worktree -- never back to the real location.
  // config_dir is forced to "" so the engine keeps using the resolved repo
  // root's own subfolder rather than a config_dir pointer that might name an
  // absolute path from the real machine's profile.
  //
  // kill_mod_hv_one_shot is force-disabled: it is the real config's one live
  // "dp2" (demoparser2) filter flag (csdm/static_data.py, kill_mod_high_velocity's
  // extra_config), and confirmed by hand to hang PREVIEW indefinitely on this
  // measurement machine at "querying events" -- almost certainly because it
  // opens each demo FILE from disk (`DemoParser(demo_path)`,
  // csdm/engine/core.py ~4685) at the ABSOLUTE PATH the real machine's DB
  // recorded, which this machine does not have mounted. General S1/S2/S3
  // scenarios want a clean "kills only" baseline; the dp2 code path is
  // exercised on purpose and only for S3-dp2 / reference config B, by
  // toggling `kill_mod_spray_transfer` live in the UI, not by anything
  // inherited here.
  const seeded = { ...realCfg, config_dir: "", kill_mod_hv_one_shot: false };
  writeFileSync(ISOLATED_CONFIG_FILE, JSON.stringify(seeded, null, 2), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════
//  Windows process helpers (PowerShell/CIM) -- CPU%, RSS, GPU
// ═══════════════════════════════════════════════════════════════════════
function psJson(script) {
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const trimmed = out.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Every descendant of `rootPid` (the exe's own main/browser process), via Win32_Process. */
function getProcessTree(rootPid) {
  const rows = psJson(
    "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress",
  );
  const byParent = new Map();
  for (const p of rows) {
    const list = byParent.get(p.ParentProcessId) || [];
    list.push(p);
    byParent.set(p.ParentProcessId, list);
  }
  const result = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of byParent.get(pid) || []) {
      result.push(child);
      queue.push(child.ProcessId);
    }
  }
  return result;
}

function classifyTree(tree) {
  const isRenderer = (p) => /--type=renderer/i.test(p.CommandLine || "");
  const isGpu = (p) => /--type=gpu-process/i.test(p.CommandLine || "");
  return {
    renderer: tree.filter(isRenderer).map((p) => p.ProcessId),
    gpu: tree.filter(isGpu).map((p) => p.ProcessId),
    python: tree.filter((p) => /python/i.test(p.Name || "")).map((p) => p.ProcessId),
    allPids: tree.map((p) => p.ProcessId),
  };
}

function getCpuAndMemory(pids) {
  if (pids.length === 0) return {};
  try {
    const filter = pids.map((pid) => `$_.IDProcess -eq ${pid}`).join(" -or ");
    const rows = psJson(
      `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { ${filter} } ` +
      "| Select-Object IDProcess, Name, PercentProcessorTime, WorkingSetPrivate, PrivateBytes | ConvertTo-Json -Compress",
    );
    const byPid = {};
    for (const row of rows) {
      byPid[row.IDProcess] = {
        name: row.Name,
        cpuPercent: row.PercentProcessorTime,
        workingSetBytes: row.WorkingSetPrivate,
        privateBytes: row.PrivateBytes,
      };
    }
    return byPid;
  } catch (error) {
    return { error: String(error) };
  }
}

function getGpuUtilization(pids) {
  try {
    const out = execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      "try { (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop)" +
      ".CounterSamples | Select-Object InstanceName, CookedValue | ConvertTo-Json -Compress } " +
      "catch { Write-Output 'UNAVAILABLE' }",
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
    if (out === "UNAVAILABLE" || out === "") {
      return { available: false, reason: "GPU Engine counter set not accessible on this machine" };
    }
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const byPid = {};
    for (const row of rows) {
      const match = /pid_(\d+)_/.exec(row.InstanceName || "");
      if (!match) continue;
      const pid = Number(match[1]);
      if (!pids.includes(pid)) continue;
      byPid[pid] = (byPid[pid] || 0) + row.CookedValue;
    }
    return { available: true, byPid };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

function sampleProcesses(rootPid) {
  const tree = getProcessTree(rootPid);
  const classified = classifyTree(tree);
  const allPids = [rootPid, ...classified.allPids];
  const cpuMem = getCpuAndMemory(allPids);
  const gpu = getGpuUtilization(allPids);
  return {
    at: Date.now(),
    pids: { main: rootPid, ...classified },
    cpuMem,
    gpu,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Main-process inspector (PERF_OFFSCREEN=1 only): reaches the real
//  BrowserWindow instead of CDP proxies. See launchPackagedExe for why this
//  exists and connectMainProcessInspector for how it works.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Talks to the packaged exe's own `--inspect=<port>` (Node/main-process
 * debugger, NOT the renderer's `--remote-debugging-port`). Confirmed by hand
 * this is NOT blocked by an Electron fuse on this build (the endpoint answers
 * normally). `require` is reachable ONLY with `includeCommandLineAPI: true`:
 * plain `Runtime.evaluate` reports "require is not defined" (confirmed) --
 * `require` is not a real global, it is a per-module wrapper argument, and
 * only the CommandLine-API evaluation path (the same one DevTools' own
 * console uses) injects a working shim for it. This is what actually reaches
 * `require('electron').BrowserWindow` -- the file header's older note about
 * main-process RPC being unreachable was true for plain `Runtime.evaluate`
 * and for Playwright's `_electron.launch()`, but not for this path.
 */
async function connectMainProcessInspector(port) {
  let targets = null;
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline && !targets) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!targets || !targets[0]) throw new Error("main-process inspector never came up");

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("main-process inspector socket never opened")),
      LAUNCH_TIMEOUT_MS,
    );
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("main-process inspector socket failed")); };
  });
  function send(method, params) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await send("Runtime.enable", {});

  return {
    async eval(expression) {
      const response = await send("Runtime.evaluate", {
        expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
      });
      if (response.result.exceptionDetails) {
        throw new Error(`inspector eval failed: ${JSON.stringify(response.result.exceptionDetails)}`);
      }
      return response.result.result.value;
    },
    close() { ws.close(); },
  };
}

// One shared expression prefix: always re-fetch the window rather than cache
// a reference across eval() calls -- simpler than tracking a remote object id
// over a WebSocket, and there is exactly one BrowserWindow in this app.
const MAIN_WINDOW_EXPR = "require('electron').BrowserWindow.getAllWindows()[0]";

// How far past the display union's edge to park the window, on top of the
// window's own width/height -- generous enough that a rounding difference in
// a future multi-monitor layout still clears every display.
const OFFSCREEN_MARGIN_PX = 2000;

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// ═══════════════════════════════════════════════════════════════════════
//  Launching the packaged exe (renderer CDP; see file header for why there
//  is no main-process RPC over the RENDERER's own CDP connection -- that
//  constraint stands. PERF_OFFSCREEN=1 reaches the main process a different
//  way, see connectMainProcessInspector above)
// ═══════════════════════════════════════════════════════════════════════
async function launchPackagedExe(env) {
  const cdpPort = 9223 + Math.floor(Math.random() * 500);
  // Visible only on explicit request: GPU readings are meaningless on a hidden
  // window, but a visible one steals the user's screen -- the caller decides.
  const background = process.env.PERF_VISIBLE === "1" ? {} : { CSDM_E2E_BACKGROUND: "1" };
  const offscreen = process.env.PERF_OFFSCREEN === "1";
  const visible = process.env.PERF_VISIBLE === "1";
  // Both modes need the real BrowserWindow: offscreen to park and show the
  // window, visible to give it real OS focus and to minimise / unfocus it
  // for real (criterion 2) instead of through CDP proxies.
  const inspectPort = offscreen || visible ? 20000 + Math.floor(Math.random() * 2000) : null;
  const args = [`--remote-debugging-port=${cdpPort}`];
  if (inspectPort) args.push(`--inspect=${inspectPort}`);
  if (offscreen) {
    // A window positioned entirely off every display is still "occluded" as
    // far as Windows' native occlusion tracking is concerned (no monitor
    // shows any of its pixels), and Chromium throttles rAF to ~1 Hz for an
    // occluded renderer exactly like it does for a truly hidden one --
    // confirmed by hand: without this switch, an off-screen-but-shown window
    // still measured ~1 rAF/s; with it, ~90-100/s. This is a Chromium
    // command-line SWITCH (process-start-time, not `app.commandLine` from
    // inside main.js -- no product code change).
    args.push("--disable-features=CalculateNativeWinOcclusion");
  }
  const child = spawn(EXE_PATH, args, {
    cwd: ELECTRON_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...env, ...background },
  });

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let browser = null;
  while (Date.now() < deadline && !browser) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) throw new Error("CDP endpoint never came up");

  let page = null;
  const pageDeadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < pageDeadline && !page) {
    page = browser.contexts()[0]?.pages().find((p) => p.url().includes("index.html")) ?? null;
    if (!page) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!page) throw new Error("renderer page not found");

  await page.waitForFunction(
    () => document.querySelector(".console")?.textContent?.includes("engine ready"),
    null, { timeout: LAUNCH_TIMEOUT_MS },
  );

  // Tears down everything this launch started -- shared by the returned
  // close() and by the offscreen safety check below, which must be able to
  // kill the tree and throw rather than ever hand back a launch that failed
  // its own "never on the user's screen" guarantee.
  async function killEverything() {
    if (inspector) { try { inspector.close(); } catch { /* already gone */ } }
    try { await browser.close(); } catch { /* already gone */ }
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 500)); // let the tree actually die
  }

  let inspector = null;
  if (visible && !offscreen) {
    inspector = await connectMainProcessInspector(inspectPort);
    // Criterion 1 is measured on a visible AND focused window. A detached
    // child is not guaranteed the foreground on Windows, so ask for it; the
    // callers record what the OS actually granted rather than assuming it.
    await inspector.eval(`(() => { const w = ${MAIN_WINDOW_EXPR}; w.show(); w.focus(); })()`);
    // Playwright's connectOverCDP turns focus emulation ON for the pages it
    // attaches to: document.hasFocus() is pinned to true and the window's
    // real blur/focus events never reach the page -- confirmed by hand: with
    // another window focused in front, hasFocus stayed true and no blur
    // fired until this was switched off. A visible run must see the real OS
    // focus, or the motion gate (useWindowActivity) can never close.
    const focusSession = await page.context().newCDPSession(page);
    await focusSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await page.waitForTimeout(500);
  }
  if (offscreen) {
    inspector = await connectMainProcessInspector(inspectPort);
    // The window is created with show:false (CSDM_E2E_BACKGROUND=1 above), so
    // nothing has ever painted on the user's real screen. Position is derived
    // from the LIVE display layout (never a hand-checked constant -- a future
    // monitor arrangement must not silently place the window back on screen):
    // fully left of and above the union of every display's bounds, so its x
    // range alone guarantees no rectangle intersection regardless of y.
    // `showInactive()` (never `show()`/`focus()`) so it never requests OS
    // input focus either.
    const displays = await inspector.eval(
      `JSON.stringify(require('electron').screen.getAllDisplays().map((d) => d.bounds))`,
    );
    const displayBounds = JSON.parse(displays);
    const unionMinX = Math.min(...displayBounds.map((d) => d.x));
    const unionMinY = Math.min(...displayBounds.map((d) => d.y));
    const currentBounds = JSON.parse(await inspector.eval(`JSON.stringify(${MAIN_WINDOW_EXPR}.getBounds())`));
    const offscreenX = unionMinX - OFFSCREEN_MARGIN_PX - currentBounds.width;
    const offscreenY = unionMinY - OFFSCREEN_MARGIN_PX - currentBounds.height;

    await inspector.eval(`${MAIN_WINDOW_EXPR}.setPosition(${offscreenX}, ${offscreenY})`);
    await inspector.eval(`${MAIN_WINDOW_EXPR}.showInactive()`);

    // Never trust the positioning blind: re-read the actual bounds and focus
    // state after showing, and refuse to hand back a launch that could be on
    // the user's screen or holding real input focus.
    const afterBounds = JSON.parse(await inspector.eval(`JSON.stringify(${MAIN_WINDOW_EXPR}.getBounds())`));
    const onAnyDisplay = displayBounds.some((d) => rectsIntersect(afterBounds, d));
    const isOursFocused = await inspector.eval(
      `require('electron').BrowserWindow.getFocusedWindow() === ${MAIN_WINDOW_EXPR}`,
    );
    if (onAnyDisplay || isOursFocused) {
      await inspector.eval(`${MAIN_WINDOW_EXPR}.hide()`).catch(() => {});
      await killEverything();
      throw new Error(
        `offscreen safety check failed: onAnyDisplay=${onAnyDisplay} isOursFocused=${isOursFocused} `
        + `bounds=${JSON.stringify(afterBounds)} displays=${displays} -- refusing to measure`,
      );
    }
  }

  return {
    page,
    browser,
    mainPid: child.pid,
    inspector,
    async close() {
      await killEverything();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CDP / page helpers
// ═══════════════════════════════════════════════════════════════════════
async function metricsMap(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

function diffMetrics(before, after) {
  const keys = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration",
    "LayoutCount", "RecalcStyleCount", "JSHeapUsedSize", "Nodes", "Documents"];
  const out = {};
  for (const key of keys) {
    if (before[key] === undefined || after[key] === undefined) continue;
    out[key] = key === "JSHeapUsedSize" || key === "Nodes" || key === "Documents"
      ? after[key] // absolute, not a delta
      : after[key] - before[key];
  }
  return out;
}

/** Counts calls TO requestAnimationFrame from the moment it is installed --
 * does not itself schedule a frame. See file header. */
async function installRafSpy(page) {
  await page.evaluate(() => {
    if (window.__csdmRafSpyInstalled) return;
    window.__csdmRafSpyInstalled = true;
    window.__csdmRafCalls = 0;
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      window.__csdmRafCalls += 1;
      return native(cb);
    };
  });
}

async function readAndResetRafSpy(page) {
  return page.evaluate(() => {
    const n = window.__csdmRafCalls || 0;
    window.__csdmRafCalls = 0;
    return n;
  });
}

async function domNodeCount(page) {
  return page.evaluate(() => document.querySelectorAll("*").length);
}

async function switchTab(page, tabId) {
  await page.getByRole("tab", { name: TAB_LABELS[tabId], exact: true }).click();
}

/**
 * Fills the two DateField inputs DemoSelectionSection renders
 * (id="date-from"/"date-to") and waits until the controlled inputs show the
 * typed value -- i.e. the settings store (what PREVIEW sends as `cfg`) holds
 * it. `dd-mm-yyyy` is what the field stores; the engine accepts it since
 * `_qe_epoch_bounds` normalizes both formats (the reason 10/100/max once all
 * scanned the same 837 demos: it only parsed `yyyy-mm-dd`).
 */
async function setDateRange(page, fromDdMmYyyy, toDdMmYyyy) {
  await switchTab(page, "capture");
  for (const [selector, value] of [["#date-from", fromDdMmYyyy], ["#date-to", toDdMmYyyy]]) {
    const input = page.locator(selector);
    await input.fill(value);
    await input.press("Tab");
    await page.waitForFunction(
      ([sel, expected]) => document.querySelector(sel)?.value === expected,
      [selector, value], { timeout: 10000 },
    );
  }
}

/**
 * Sets a filter row's Enable chip to `wanted` through the same button the
 * user clicks. Located by its config key (`SettingControl` renders
 * `data-config-key`, FilterRow wraps Enable in `data-action="G1"`), not by
 * visible text: "Enable" appears once per row. Waits for `aria-pressed` to
 * flip, so the setting is in the store before PREVIEW reads it.
 */
async function setFilterEnabled(page, configKey, wanted) {
  await switchTab(page, "capture");
  const chip = page.locator(`[data-config-key="${configKey}"] [data-action="G1"] button`).first();
  await chip.scrollIntoViewIfNeeded();
  if ((await chip.getAttribute("aria-pressed")) !== String(wanted)) await chip.click();
  await page.waitForFunction(
    ([key, expected]) => document.querySelector(`[data-config-key="${key}"] [data-action="G1"] button`)
      ?.getAttribute("aria-pressed") === expected,
    [configKey, String(wanted)], { timeout: 10000 },
  );
}

const SPRAY_TRANSFER_KEY = "kill_mod_spray_transfer";

/** Switches the UI ground through SETTINGS > UI Theme > Mode, the control the user uses. */
async function setGround(page, ground) {
  await switchTab(page, "settings");
  const radio = page.getByRole("radiogroup", { name: "Ground" }).getByRole("radio", { name: ground, exact: true });
  await radio.scrollIntoViewIfNeeded();
  await radio.click();
  await page.waitForFunction(
    (g) => [...document.querySelectorAll('[role="radiogroup"][aria-label="Ground"] [role="radio"]')]
      .some((el) => el.textContent.trim() === g && el.getAttribute("aria-checked") === "true"),
    ground, { timeout: 10000 },
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Reading the engine state straight out of React (I8's real answer, and
//  PREVIEW completion)
// ═══════════════════════════════════════════════════════════════════════
//
// Three dead ends tried first, kept here so nobody repeats them:
//   1. Waiting for an "N clips … M demos" console line. PREVIEW
//      (`_preview_worker` in csdm/engine/core.py) never writes one -- only
//      RUN (`_worker`) does. PREVIEW goes straight from `preview_started` to
//      `preview_ready`. The "players: … / filters: …" block visible in the
//      console the instant PREVIEW is clicked is CLIENT-SIDE narration
//      synthesized from the config (`shell/consoleNarrative.ts`), not engine
//      progress -- waiting on it hangs forever regardless of real speed.
//   2. Wrapping `window.bridge.onMessage` (exposed via Electron's
//      `contextBridge`). Confirmed by hand: `Object.isFrozen(window.bridge)`
//      is true (`writable: false, configurable: false` on every property) --
//      contextBridge freezes what it exposes so the untrusted renderer world
//      cannot tamper with it. The reassignment fails silently (non-strict
//      mode), so the wrap looked installed but never fired.
//   3. `--inspect` on the Electron main process for `Runtime.evaluate`
//      there. No `require`, no registered dynamic-import callback
//      (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`) in that context.
//
// What actually works: `motion/engineStore.ts` keeps the entire engine state
// (including `previewClips`, `previewSerial`, `busy`) as the return value of
// a `useSyncExternalStore` hook read by several mounted components (AppShell
// keeps all 5 tabs mounted, so EditingTab's fiber exists regardless of which
// tab is visible). React (still, in 19) stores a hook's value in
// `fiber.memoizedState.memoizedState` on a plain linked list -- ordinary
// object properties, not contextBridge-frozen, not Node/main-process, reads
// directly off the DOM's own fiber pointers. This is the same technique
// React DevTools itself uses, just inlined instead of npm-installed.
function fiberReadExpression() {
  return `(() => {
    function checkHooks(fiber) {
      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard < 50) {
        guard++;
        const val = hook.memoizedState;
        if (val && typeof val === "object" && Array.isArray(val.previewClips)) return val;
        if (!("next" in hook)) break;
        hook = hook.next;
      }
      return null;
    }
    // Builds after "fix perf 2/2" task 4 hold no whole-state hook any more:
    // every reader subscribes to a slice (useEngineSelector). EditingTab's
    // first two store subscriptions are exactly the two slices this bench
    // needs -- previewClips (the store's own array) then previewSerial -- and
    // it is the only component whose store hooks start [Array, number].
    function checkSliceHooks(fiber) {
      const values = [];
      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard < 50 && values.length < 2) {
        guard++;
        if (hook.queue && typeof hook.queue.getSnapshot === "function") values.push(hook.memoizedState);
        if (!("next" in hook)) break;
        hook = hook.next;
      }
      if (values.length === 2 && Array.isArray(values[0]) && typeof values[1] === "number") {
        return { previewClips: values[0], previewSerial: values[1], readFrom: "slices" };
      }
      return null;
    }
    function walkSlices(fiber, depth) {
      if (!fiber || depth > 80) return null;
      const found = checkSliceHooks(fiber);
      if (found) return found;
      let child = fiber.child;
      while (child) {
        const r = walkSlices(child, depth + 1);
        if (r) return r;
        child = child.sibling;
      }
      return null;
    }
    function walk(fiber, depth) {
      if (!fiber || depth > 80) return null;
      const found = checkHooks(fiber);
      if (found) return found;
      let child = fiber.child;
      while (child) {
        const r = walk(child, depth + 1);
        if (r) return r;
        child = child.sibling;
      }
      return null;
    }
    const root = document.querySelector("#root");
    if (!root) return null;
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    if (!key) return null;
    return walk(root[key], 0) ?? walkSlices(root[key], 0);
  })()`;
}

/** The live `EngineState` (motion/engineStore.ts), read straight from React. */
async function readEngineState(page) {
  return page.evaluate(fiberReadExpression());
}

/**
 * Click PREVIEW, then poll the engine state until `previewSerial` increments
 * past what it was before the click (never resets, so this is unambiguous --
 * see engineStore.ts's own comment on why `previewReady` alone cannot tell
 * "a new preview" from "the same one still showing"). Falls back to scanning
 * the console for "Preview error" / "AttributeError" if the serial never
 * moves, so a caught-and-logged exception is distinguishable from "still
 * computing" and from a truly stuck worker (`noSummaryWithinTimeout`).
 */
async function runPreviewAndWait(page, timeoutMs) {
  const before = await readEngineState(page);
  const previousSerial = before?.previewSerial ?? 0;
  // PREVIEW only exists on the capture action bar. A preview that returns
  // clips switches the app to EDITING (AppShell's previewSerial effect), whose
  // bar shows GENERATE / SAVE / CANCEL instead, so a second click in a row
  // waited on a button that was not mounted. Go back first, as a user would.
  await switchTab(page, "capture");
  // A large previewClips array (thousands, e.g. N=max) re-renders EditingTab
  // in full (all 5 tabs stay mounted -- AUDIT_perf_ressources.md suspect 4)
  // and can keep the main thread busy long enough that Playwright's default
  // 30s actionability wait on the click itself times out, well before the
  // preview logic even starts. The click gets the same generous budget as
  // the wait that follows it.
  await page.locator('button[data-action="A2"]').click({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await readEngineState(page);
    if (state && state.previewSerial > previousSerial) {
      return { clips: state.previewClips.length, demos: new Set(state.previewClips.map((c) => c.demoPath)).size, state };
    }
    await page.waitForTimeout(200);
  }
  const consoleText = (await page.locator(".console").textContent().catch(() => "")) ?? "";
  const errorMatch = /.{0,150}(preview error|_dp2_cache_put_locked|AttributeError).{0,150}/i.exec(consoleText);
  return {
    clips: null, demos: null, state: null,
    noSummaryWithinTimeout: !errorMatch,
    sawPreviewError: Boolean(errorMatch),
    errorContext: errorMatch ? errorMatch[0] : null,
    consoleTail: consoleText.slice(-1500),
  };
}

/** Task 3: the clip identity fields the plan asks for, sorted. */
function referenceClipsFromState(state) {
  const clips = (state?.previewClips ?? []).map((c) => ({
    demoPath: c.demoPath, startTick: c.startTick, endTick: c.endTick,
    eventType: c.eventType, playerName: c.playerName,
  }));
  clips.sort((a, b) => (a.demoPath === b.demoPath ? a.startTick - b.startTick : a.demoPath.localeCompare(b.demoPath)));
  return clips;
}

// ═══════════════════════════════════════════════════════════════════════
//  Scenarios
// ═══════════════════════════════════════════════════════════════════════
async function runS1(page, cdp, mainPid) {
  const perTab = [];
  for (const tabId of TABS) {
    await switchTab(page, tabId);
    await page.waitForTimeout(500); // let the tab settle before sampling
    await installRafSpy(page);
    await readAndResetRafSpy(page); // discard the tab-switch's own frames
    const before = await metricsMap(cdp);
    const procBefore = sampleProcesses(mainPid);
    await page.waitForTimeout(IDLE_MS);
    const after = await metricsMap(cdp);
    const procAfter = sampleProcesses(mainPid);
    const rafCalls = await readAndResetRafSpy(page);
    perTab.push({
      tab: tabId,
      hasFocus: await page.evaluate(() => document.hasFocus()),
      idleMs: IDLE_MS,
      metricsDelta: diffMetrics(before, after),
      rafCallsDuringIdle: rafCalls,
      processesBefore: procBefore,
      processesAfter: procAfter,
    });
  }
  return perTab;
}

/** Same idle measurement as S1, but with prefers-reduced-motion forced via
 * CDP Emulation -- isolates suspects 1 and 5 (Backdrop's rAF loop, and the
 * backdrop-filter surfaces that recomposite because of it) without touching
 * product code. */
async function runS1Isolation(page, cdp, mainPid) {
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await switchTab(page, "capture");
  await page.waitForTimeout(500);
  await installRafSpy(page);
  await readAndResetRafSpy(page);
  const before = await metricsMap(cdp);
  const procBefore = sampleProcesses(mainPid);
  await page.waitForTimeout(IDLE_MS);
  const after = await metricsMap(cdp);
  const procAfter = sampleProcesses(mainPid);
  const rafCalls = await readAndResetRafSpy(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }); // restore
  return {
    tab: "capture",
    idleMs: IDLE_MS,
    metricsDelta: diffMetrics(before, after),
    rafCallsDuringIdle: rafCalls,
    processesBefore: procBefore,
    processesAfter: procAfter,
  };
}

/** Task 4: isolates suspect 5 (backdrop-filter surfaces recompositing every
 * frame because the canvas under them changes) independently of suspect 1 --
 * the Backdrop's own rAF loop keeps running here (intensity stays "full"),
 * only the blur is removed, via a plain injected stylesheet (no product code
 * touched, gone on the next launch). */
async function runS1NoBackdropFilter(page, cdp, mainPid) {
  const styleTag = await page.addStyleTag({
    content: "* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
  });
  await switchTab(page, "capture");
  await page.waitForTimeout(500);
  await installRafSpy(page);
  await readAndResetRafSpy(page);
  const before = await metricsMap(cdp);
  const procBefore = sampleProcesses(mainPid);
  await page.waitForTimeout(IDLE_MS);
  const after = await metricsMap(cdp);
  const procAfter = sampleProcesses(mainPid);
  const rafCalls = await readAndResetRafSpy(page);
  await styleTag.evaluate((el) => el.remove()).catch(() => {});
  return {
    tab: "capture",
    idleMs: IDLE_MS,
    metricsDelta: diffMetrics(before, after),
    rafCallsDuringIdle: rafCalls,
    processesBefore: procBefore,
    processesAfter: procAfter,
  };
}

/**
 * Task 4: a raw CDP `Tracing` capture (devtools.timeline category) around an
 * action, reduced to the 5 costliest event names by summed duration. This is
 * the trace-domain equivalent of `Performance.getMetrics` -- coarser
 * granularity than a DevTools-recorded profile, but enough to name what is
 * actually expensive without loading a .json trace file by hand afterward.
 */
async function captureTrace(cdp, actionFn) {
  const events = [];
  const onData = (params) => { if (params.value) events.push(...params.value); };
  cdp.on("Tracing.dataCollected", onData);
  const tracingComplete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
  await actionFn();
  await cdp.send("Tracing.end");
  await tracingComplete;
  cdp.off("Tracing.dataCollected", onData);
  const byName = {};
  for (const e of events) {
    if (typeof e.dur === "number") {
      byName[e.name] = (byName[e.name] || 0) + e.dur;
    }
  }
  const top5 = Object.entries(byName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, totalDurUs]) => ({ name, totalDurUs, totalDurMs: totalDurUs / 1000 }));
  return { top5, totalEventCount: events.length };
}

async function runS2(page, cdp) {
  const switches = [];
  for (let i = 0; i < TAB_SWITCH_COUNT; i += 1) {
    const tabId = TABS[i % TABS.length];
    const before = await metricsMap(cdp);
    const t0 = Date.now();
    await switchTab(page, tabId);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const commitMs = Date.now() - t0;
    const after = await metricsMap(cdp);
    switches.push({ tab: tabId, commitMs, metricsDelta: diffMetrics(before, after) });
  }
  return switches;
}

async function runS3ForLabel(page, cdp, mainPid, label, boundary) {
  await setDateRange(page, isoToDdMmYyyy(boundary.from), isoToDdMmYyyy(boundary.to));
  const heapBefore = (await metricsMap(cdp)).JSHeapUsedSize;
  const procBefore = sampleProcesses(mainPid);
  const domBefore = await domNodeCount(page);
  const t0 = Date.now();
  const result = await runPreviewAndWait(page, PREVIEW_TIMEOUT_MS);
  const previewMs = Date.now() - t0;
  const heapAfter = (await metricsMap(cdp)).JSHeapUsedSize;
  const procAfter = sampleProcesses(mainPid);
  const domAfter = await domNodeCount(page);
  await switchTab(page, "editing");
  const editingDomNodes = await domNodeCount(page);
  await markEditingViewedAndReturn(page);
  return {
    label,
    dbEstimatedCount: boundary.estimatedCount,
    dateRange: boundary,
    engineReportedSummary: { clips: result.clips, demos: result.demos },
    noSummaryWithinTimeout: result.noSummaryWithinTimeout ?? false,
    previewMs,
    domNodesBeforePreview: domBefore,
    domNodesAfterPreview: domAfter,
    editingTabDomNodes: editingDomNodes,
    jsHeapUsedBytesBefore: heapBefore,
    jsHeapUsedBytesAfter: heapAfter,
    processesBefore: procBefore,
    processesAfter: procAfter,
  };
}

/** Visits the editing tab (clears `editingBadge`) then returns to capture,
 * so the NEXT preview's completion is unambiguous the same way. Not needed
 * for `previewSerial` detection itself (it never resets), but keeps the UI
 * state clean between scenarios the same way a real user would. */
async function markEditingViewedAndReturn(page) {
  await switchTab(page, "capture");
}

async function runS3Bis(page, cdp, mainPid, boundary) {
  await setDateRange(page, isoToDdMmYyyy(boundary.from), isoToDdMmYyyy(boundary.to));
  const rounds = [];
  for (let i = 0; i < PREVIEW_REPEATS; i += 1) {
    try {
      const procBefore = sampleProcesses(mainPid);
      const heapBefore = (await metricsMap(cdp)).JSHeapUsedSize;
      const result = await runPreviewAndWait(page, PREVIEW_TIMEOUT_MS);
      const heapAfter = (await metricsMap(cdp)).JSHeapUsedSize;
      const procAfter = sampleProcesses(mainPid);
      rounds.push({
        round: i + 1, summary: { clips: result.clips, demos: result.demos },
        jsHeapUsedBytesBefore: heapBefore, jsHeapUsedBytesAfter: heapAfter,
        pythonRssAfter: procAfter.cpuMem, // keyed by pid; see pids.python
        pids: procAfter.pids,
      });
    } catch (error) {
      // A round timing out (observed: repeated N=max previews can leave the
      // renderer unresponsive for minutes -- suspect 4) must not discard the
      // rounds that already succeeded.
      rounds.push({ round: i + 1, error: String(error.message || error) });
      break; // the app is very likely still stuck; further rounds would just repeat the timeout
    }
  }
  return rounds;
}

/** Enables a demoparser2-dependent filter (spray transfer) and runs PREVIEW,
 * to confirm or rule out suspect 3 (`_dp2_cache_put_locked` missing on
 * `BridgeHost`, static proof: `csdm/bridge/host.py:25` extends
 * `EngineStateMixin, EngineMixin` but not the Tkinter `App` that actually
 * defines the method). Three distinguishable outcomes, not collapsed into
 * one boolean:
 *   - `noSummaryWithinTimeout: true` -- PREVIEW never finished. Consistent
 *     with a worker thread dying mid-preview and `buttons_idle` never firing.
 *   - `attributeErrorSeen: true` with a summary -- the exception was caught
 *     somewhere up the call stack (this codebase wraps a lot of per-demo work
 *     in try/except) and PREVIEW degraded rather than died: worth noting,
 *     still a bug, just not a fatal one.
 *   - neither -- either the fix already landed, or these demos never hit a
 *     code path that calls `_dp2_cache_put_locked` (e.g. no spray-eligible
 *     kill in range). `dbEstimatedCount` is logged so this ambiguity is
 *     visible rather than silently read as "no bug".
 */
async function runS3Dp2(page, boundary) {
  await setDateRange(page, isoToDdMmYyyy(boundary.from), isoToDdMmYyyy(boundary.to));
  await setFilterEnabled(page, SPRAY_TRANSFER_KEY, true);
  const result = await runPreviewAndWait(page, PREVIEW_TIMEOUT_MS);
  const fullConsoleText = (await page.locator(".console").textContent().catch(() => "")) ?? "";
  const attributeErrorMatch = /.{0,120}(_dp2_cache_put_locked|AttributeError).{0,120}/i.exec(fullConsoleText);
  await setFilterEnabled(page, SPRAY_TRANSFER_KEY, false); // leave it as found
  return {
    dateRange: boundary,
    noSummaryWithinTimeout: result.noSummaryWithinTimeout ?? false,
    sawPreviewError: result.sawPreviewError ?? false,
    attributeErrorSeen: Boolean(attributeErrorMatch) || Boolean(result.errorContext && /_dp2_cache_put_locked|AttributeError/i.test(result.errorContext)),
    attributeErrorContext: attributeErrorMatch ? attributeErrorMatch[0] : result.errorContext,
    summary: result.state ? { clips: result.clips, demos: result.demos } : null,
    consoleTail: fullConsoleText.slice(-1500),
  };
}

/** Task 3: one PREVIEW under a fixed config, clip list serialized+sorted,
 * from the live engine state `runPreviewAndWait` already read. */
function referenceSetFromResult(result, label) {
  const clips = referenceClipsFromState(result.state);
  return { label, clipCount: clips.length, clips };
}

// ═══════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`[perf-baseline] DRY_RUN=${DRY_RUN} worktree=${WORKTREE_ROOT}`);

  const real = realProfilePaths();
  const beforeHashes = {
    paths: real,
    csdmConfig: sha1(real.csdmConfig),
    profileConfig: sha1(real.profileConfig),
  };
  console.log(`[perf-baseline] real profile sha1 before: csdm_config.json=${beforeHashes.csdmConfig} profile/csdm_config.json=${beforeHashes.profileConfig}`);

  const creds = readRealDbCreds();
  const realCfg = JSON.parse(readFileSync(real.csdmConfig, "utf8"));
  const dbInfo = computeDateBoundaries(creds, realCfg.steam_ids ?? [], [...new Set([...DATASET_LABELS, "10", "max"])]);
  console.log(`[perf-baseline] DB: ${dbInfo.total} demos for the seeded player, ${dbInfo.datedOnDisk} dated on disk (engine date source), range ${dbInfo.minDate} .. ${dbInfo.maxDate}`);
  console.log(`[perf-baseline] date boundaries: ${JSON.stringify(dbInfo.boundaries)}`);

  seedIsolatedProfile(realCfg);
  console.log(`[perf-baseline] isolated profile seeded at ${ISOLATED_CONFIG_FILE}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(REFERENCE_DIR, { recursive: true });

  const cleanEnv = { ...process.env, CSDM_REPO_ROOT: WORKTREE_ROOT };
  delete cleanEnv.PYTHONPATH;
  delete cleanEnv.VIRTUAL_ENV;
  delete cleanEnv.CSDM_PYTHON_PATH;

  const runs = [];
  for (let runIndex = 0; runIndex < RUN_COUNT; runIndex += 1) {
    console.log(`[perf-baseline] ── run ${runIndex + 1}/${RUN_COUNT} ──`);
    // Every launch starts from the same seeded profile. The app saves settings
    // 400 ms after a change and `close()` force-kills the tree, so the last
    // toggle of a run (SPRAY TRANSFER back off) never reached the file: the
    // next run inherited spray transfer ON, every preview returned 0 clips and
    // the scenarios that open EDITING after a preview failed.
    if (runIndex > 0) seedIsolatedProfile(realCfg);
    const { page, browser, mainPid, close } = await launchPackagedExe(cleanEnv);
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");

      const result = { runIndex, mainPid };

      // One scenario hanging (confirmed: N=max repeated previews can leave
      // the renderer's main thread starved for minutes -- consistent with
      // suspect 4, EditingTab rendering thousands of unvirtualized rows
      // across all 5 permanently-mounted tabs) must not lose every
      // measurement collected before it. Each scenario is isolated; a
      // failure is recorded as `{ error }` and the run continues.
      async function safe(label, fn) {
        try {
          return await fn();
        } catch (error) {
          console.error(`[perf-baseline] scenario ${label} failed: ${error.message}`);
          return { error: String(error.message || error) };
        }
      }

      result.s1 = await safe("s1", () => runS1(page, cdp, mainPid));
      result.s1Isolation = await safe("s1Isolation", () => runS1Isolation(page, cdp, mainPid));
      result.s1NoBackdropFilter = await safe("s1NoBackdropFilter", () => runS1NoBackdropFilter(page, cdp, mainPid));
      result.s2 = await safe("s2", () => runS2(page, cdp));

      // Task 4: CDP trace on S1 idle (capture tab, IDLE_MS, normal intensity).
      await switchTab(page, "capture");
      await page.waitForTimeout(300);
      result.s1Trace = await safe("s1Trace", () => captureTrace(cdp, () => page.waitForTimeout(IDLE_MS)));

      result.s3 = [];
      for (const label of DATASET_LABELS) {
        const boundary = dbInfo.boundaries[label];
        result.s3.push(await safe(`s3[${label}]`, () => runS3ForLabel(page, cdp, mainPid, label, boundary)));
      }

      const maxBoundary = dbInfo.boundaries.max ?? { from: "", to: "" };
      result.s3bis = await safe("s3bis", () => runS3Bis(page, cdp, mainPid, maxBoundary));

      // Task 4: CDP trace around one more N=max PREVIEW.
      result.s3MaxTrace = await safe("s3MaxTrace", async () => {
        await setDateRange(page, isoToDdMmYyyy(maxBoundary.from), isoToDdMmYyyy(maxBoundary.to));
        return captureTrace(cdp, () => runPreviewAndWait(page, PREVIEW_TIMEOUT_MS));
      });

      result.s3dp2 = await safe("s3dp2", () => runS3Dp2(page, dbInfo.boundaries["10"] ?? maxBoundary));
      result.reactRerenderCounts = { status: "not_measured", reason: "no React Profiler hook in a production build; see file header" };
      result.bridgeMessagesDuringPreview = {
        status: "not_measured",
        reason: "window.bridge is frozen by Electron's contextBridge (Object.isFrozen === true, confirmed by hand); "
          + "wrapping onMessage fails silently. PREVIEW itself only ever emits preview_started + preview_ready "
          + "(no per-tick messages) -- the tick-storm concern (I8) is specifically about RUN's progress/demo_entry "
          + "events, which this audit never triggers (no CS2 launches, per plan scope).",
      };

      // The minimized-window scenario (I2) was removed: scripted runs use a
      // hidden window (CSDM_E2E_BACKGROUND=1), so there is never a visible
      // window to minimize/restore in the first place.
      runs.push(result);
      // Persist after every run: a later crash must not lose a finished pass.
      writeFileSync(path.join(OUTPUT_DIR, "perf-baseline.partial.json"), JSON.stringify({ db: dbInfo, runs }, null, 2));
    } finally {
      await close();
    }
  }

  // ── Task 3: reference set (2 fixed configs) + tab screenshots ──────────
  // Caught, not propagated: the `runs` array above is the expensive result
  // (two full measurement passes) and must reach perf-baseline.json even if
  // the reference set hangs the same way N=max repeated previews can (see
  // `safe()` above).
  let referenceSetError = null;
  let startupConsole = null;
  seedIsolatedProfile(realCfg); // same reason as before each run
  const reference = await launchPackagedExe(cleanEnv);
  const { page: referencePage } = reference;
  try {
    await referencePage.setViewportSize({ width: 1600, height: 900 });
    // Startup log as the engine wrote it: `apply_discovery` warns here when it
    // finds no matches date column (the date-filter diagnosis, Task 1 step 2).
    const text = (await referencePage.locator(".console").textContent().catch(() => "")) ?? "";
    startupConsole = { dateColumnWarning: /Date column not detected/.test(text), text: text.slice(0, 4000) };

    // Screenshots first, on the fresh launch: the previews below fill
    // EDITING and change what every tab shows.
    await setGround(referencePage, "white");
    for (const tabId of TABS) {
      await switchTab(referencePage, tabId);
      await referencePage.waitForTimeout(300);
      await referencePage.screenshot({ path: path.join(REFERENCE_DIR, `tab-${tabId}-light.png`) });
    }
    // Dark mode through the user's own control (SETTINGS > UI Theme > Mode),
    // then back to light so the isolated profile ends as it started.
    await setGround(referencePage, "dark");
    await switchTab(referencePage, "settings");
    await referencePage.waitForTimeout(300);
    await referencePage.screenshot({ path: path.join(REFERENCE_DIR, "tab-settings-dark.png") });
    await setGround(referencePage, "white");

    // Config A: the seeded config (kills only), with NO date bound. The
    // seeded range (the real profile's own dates) became live once the
    // engine learnt to read the Electron date format, and it selects almost
    // nothing on this machine (the filter only keeps demos whose file is on
    // disk -- see `engineDemoDates`). No bound = the full clip list, and a
    // list that does not depend on which demo files happen to be mounted.
    await setDateRange(referencePage, "", "");
    await setFilterEnabled(referencePage, SPRAY_TRANSFER_KEY, false);
    const resultA = await runPreviewAndWait(referencePage, PREVIEW_TIMEOUT_MS);
    const refA = referenceSetFromResult(resultA, "A-kills-only");
    writeFileSync(
      path.join(REFERENCE_DIR, "preview-A.json"),
      JSON.stringify({
        summary: resultA.state
          ? { clips: resultA.clips, demos: resultA.demos }
          : { noSummaryWithinTimeout: resultA.noSummaryWithinTimeout, sawPreviewError: resultA.sawPreviewError, errorContext: resultA.errorContext, consoleTail: resultA.consoleTail },
        ...refA,
      }, null, 2),
    );

    // Config B: A + SPRAY TRANSFER (a demoparser2 filter -- exercises the
    // `_dp2_cache_put_locked` bug, same detection as runS3Dp2). Only starts
    // once A has finished (`runPreviewAndWait` returns on A's own
    // `previewSerial` bump, or after its timeout).
    await setFilterEnabled(referencePage, SPRAY_TRANSFER_KEY, true);
    const tB = Date.now();
    const resultB = await runPreviewAndWait(referencePage, PREVIEW_TIMEOUT_MS);
    const previewBMs = Date.now() - tB;
    const refB = referenceSetFromResult(resultB, "B-spray-transfer");
    const consoleB = (await referencePage.locator(".console").textContent().catch(() => "")) ?? "";
    const attributeErrorB = /.{0,120}(_dp2_cache_put_locked|AttributeError).{0,120}/i.exec(consoleB);
    writeFileSync(
      path.join(REFERENCE_DIR, "preview-B.json"),
      JSON.stringify({
        previewMs: previewBMs,
        attributeErrorSeen: Boolean(attributeErrorB),
        attributeErrorContext: attributeErrorB ? attributeErrorB[0] : null,
        summary: resultB.state
          ? { clips: resultB.clips, demos: resultB.demos }
          : { noSummaryWithinTimeout: resultB.noSummaryWithinTimeout, sawPreviewError: resultB.sawPreviewError, errorContext: resultB.errorContext, consoleTail: resultB.consoleTail },
        ...refB,
      }, null, 2),
    );
  } catch (error) {
    referenceSetError = String(error.message || error);
    console.error(`[perf-baseline] reference set failed: ${referenceSetError}`);
  } finally {
    await reference.close();
  }

  // ── sha1 verification + output ──────────────────────────────────────
  const verification = verifyRealProfileUntouched(beforeHashes);
  const output = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    visible: process.env.PERF_VISIBLE === "1",
    offscreen: process.env.PERF_OFFSCREEN === "1",
    exePath: EXE_PATH,
    constants: { DATASET_LABELS, IDLE_MS, TAB_SWITCH_COUNT, PREVIEW_REPEATS, RUN_COUNT },
    db: dbInfo,
    isolatedProfile: ISOLATED_CONFIG_FILE,
    referenceSetError,
    startupConsole,
    realProfileVerification: verification,
    runs,
  };
  mkdirSync(RUN_OUTPUT_DIR, { recursive: true });
  const outFile = path.join(RUN_OUTPUT_DIR, "perf-baseline.json");
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`[perf-baseline] wrote ${outFile}`);
  console.log(`[perf-baseline] real profile untouched: ${verification.ok}`);
  if (!verification.ok) {
    console.error("[perf-baseline] REAL PROFILE CHANGED -- investigate before trusting any measurement above");
    process.exitCode = 1;
  }
}

// ── Probe mode (Task 4 isolation): who owns the idle rAF loop, and what the
// GPU engine does with and without it. PERF_PROBE=1 runs only this.
function gpuUtilForPids(pids, seconds) {
  const script = String.raw`$p=@(${pids.join(",")}); $s=Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds} -ErrorAction SilentlyContinue; `
    + String.raw`$tot=@(); foreach($set in $s){ $sum=0; foreach($c in $set.CounterSamples){ if($c.InstanceName -match 'pid_(\d+)_'){ if($p -contains [int]$Matches[1]){ $sum+=$c.CookedValue } } }; $tot+=$sum }; `
    + String.raw`$m=($tot | Measure-Object -Average -Maximum); [string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0:F2} {1:F2}',$m.Average,$m.Maximum)`;
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
  const [avg, max] = out.split(/\s+/).map((v) => Number(v.replace(",", ".")));
  return { avgPercent: avg, maxPercent: max };
}

/** Attributes every rAF callback REGISTRATION to its caller (one stack frame
 * up from requestAnimationFrame itself), so several unrelated loops (e.g. one
 * per always-mounted tab) show up as separate keys instead of one opaque
 * total. Shared by probe() and attribution()'s minimized/unfocused steps. */
// Guarded like installRafSpy -- calling this twice in the same page session
// (e.g. once for "minimized", again for "unfocused") without the guard
// double-wraps requestAnimationFrame: every real call then recurses through
// both wrappers and shows up as TWO entries with an identical count, one
// under the real caller's stack and a phantom second one under whatever line
// the first wrapper's own injected code sits on ("eval at evaluate...").
// Confirmed by hand: this is exactly what produced the previously-unexplained
// second key in before-hidden/attribution.json's `unfocused.rafBy`.
async function installRafStackSpy(page) {
  await page.evaluate(() => {
    if (window.__csdmRafStackSpyInstalled) return;
    window.__csdmRafStackSpyInstalled = true;
    const orig = window.requestAnimationFrame.bind(window);
    window.__rafBy = {};
    window.__rafOrig = orig;
    window.requestAnimationFrame = (cb) => {
      const line = (new Error().stack || "").split("\n")[2] || "?";
      const key = line.replace(/\?[^:)]*/, "").replace(/.*[\/]/, "").trim();
      window.__rafBy[key] = (window.__rafBy[key] || 0) + 1;
      return orig(cb);
    };
  });
}

async function readAndResetRafStackSpy(page) {
  return page.evaluate(() => {
    const by = window.__rafBy || {};
    window.__rafBy = {};
    return by;
  });
}

/** What the product's motion gate can see: focus, visibility, the gate's own
 * verdict on <html>, and how many CSS animations are still playing. */
async function windowGateState(page) {
  return page.evaluate(() => ({
    hasFocus: document.hasFocus(),
    hidden: document.hidden,
    dataMotion: document.documentElement.getAttribute("data-motion"),
    runningAnimationCount: document.getAnimations().filter((a) => a.playState === "running").length,
  }));
}

async function runningAnimationNames(page) {
  return page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === "running")
    .map((a) => a.animationName || a.effect?.getTiming?.()?.toString?.() || "?"));
}

/**
 * "Minimized" and "unfocused" proxies -- confirmed by hand that neither
 * `Browser.getWindowForTarget` nor `Browser.setWindowBounds` exists on this
 * exe's `--remote-debugging-port` endpoint (page-level AND browser-level CDP
 * session both answered "wasn't found"; probed directly before writing this).
 * That is consistent with the file header: Electron's own BrowserWindow API
 * is not reachable through this launch technique, and there is no window to
 * minimize in the first place under CSDM_E2E_BACKGROUND=1 -- `createWindow()`
 * (main.js) passes `show: false` AND `backgroundThrottling: false` for a
 * hidden bench run, so even a real OS-level minimize would change nothing
 * (that is the whole point of the hidden mode: unthrottled measurement).
 *
 * The closest reachable proxies, both confirmed to work over this same CDP
 * connection:
 *   - "minimized"  -> `Page.setWebLifecycleState({state: "frozen"})`, the
 *     same lifecycle transition Chromium applies to a long-backgrounded tab
 *     (pauses timers/rAF); CDP evaluation still reaches the page while frozen
 *     (confirmed: `page.evaluate` does not throw under "frozen").
 *   - "unfocused"  -> `Emulation.setFocusEmulationEnabled({enabled: false})`,
 *     confirmed to flip `document.hasFocus()` to false, which is what
 *     `window.blur()` cannot reliably do on a window that was never shown.
 * Both are named accordingly in attribution.json/the audit -- they are
 * proxies, not literal minimize/blur, and the audit says so.
 */
async function setPageLifecycleState(cdp, state) {
  await cdp.send("Page.setWebLifecycleState", { state });
}

async function setFocusEmulation(cdp, focused) {
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: !focused });
}

async function probe() {
  const real = realProfilePaths();
  const before = { paths: real, csdmConfig: sha1(real.csdmConfig), profileConfig: sha1(real.profileConfig) };
  seedIsolatedProfile(JSON.parse(readFileSync(real.csdmConfig, "utf8")));
  const env = { ...process.env, CSDM_REPO_ROOT: WORKTREE_ROOT };
  delete env.PYTHONPATH; delete env.VIRTUAL_ENV; delete env.CSDM_PYTHON_PATH;
  const { page, mainPid, close } = await launchPackagedExe(env);
  const out = { visible: process.env.PERF_VISIBLE === "1" };
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(5000);
    if (process.env.PERF_PROBE_AFTER_PREVIEW === "1") {
      // Realistic idle: after one PREVIEW the 5 always-mounted tabs hold the clip list.
      const t0 = Date.now();
      const res = await runPreviewAndWait(page, PREVIEW_TIMEOUT_MS);
      out.preview = { ms: Date.now() - t0, clips: res.clips, demos: res.demos, domNodes: await domNodeCount(page) };
      await page.waitForTimeout(5000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const m0 = await metricsMap(cdp);
      await page.waitForTimeout(15000);
      out.idleAfterPreviewMetrics15s = diffMetrics(m0, await metricsMap(cdp));
      out.processesIdleAfterPreview = sampleProcesses(mainPid);
    }
    const pids = [mainPid, ...getProcessTree(mainPid).map((p) => p.ProcessId)];
    // Attribute every rAF callback registration to its caller for 5 s.
    await installRafStackSpy(page);
    await page.waitForTimeout(5000);
    out.rafCallers = await readAndResetRafStackSpy(page);
    out.backdropCanvas = await page.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height, cls: c.className, dpr: devicePixelRatio })));
    out.gpuIdleNormal = gpuUtilForPids(pids, 15);
    // Stop every future rAF: the idle loop dies after its current frame.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.waitForTimeout(1000);
    out.gpuIdleNoRaf = gpuUtilForPids(pids, 15);
    await page.evaluate(() => { document.querySelectorAll("*").forEach((el) => { el.style.backdropFilter = "none"; }); });
    out.gpuIdleNoRafNoBlur = gpuUtilForPids(pids, 15);
  } finally {
    await close();
  }
  out.realProfile = verifyRealProfileUntouched(before);
  writeFileSync(path.join(OUTPUT_DIR, "perf-probe.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════
//  Attribution mode (Task 1, "fix perf 2/2"): idle cost broken down per
//  source, on the CAPTURE tab -- cumulative toggles (S1's "Starspin" CSS
//  animation, all CSS animations, rAF itself, then each backdrop-filter
//  surface one selector at a time), plus three isolated window-state probes
//  (minimized, unfocused, prefers-reduced-motion). PERF_ATTRIBUTION=1 runs
//  only this. Reuses probe()'s isolation/spy/GPU helpers -- same isolated
//  profile, same sha1 guard, same rAF-registration technique.
// ═══════════════════════════════════════════════════════════════════════

/** Builds a page.evaluate-able toggle whose selector is baked into the
 * function's own source (via `new Function`) rather than closed over --
 * Playwright serializes a function by `toString()`, so a normal arrow
 * function capturing the loop's `sel` would reference an undefined variable
 * once reconstructed in the page. */
function backdropOffToggle(selector) {
  return new Function(
    `document.querySelectorAll(${JSON.stringify(selector)}).forEach((el) => { `
    + `el.style.backdropFilter = "none"; el.style.webkitBackdropFilter = "none"; })`,
  );
}

const ATTRIBUTION_STEPS = [
  ["normal", null],
  // The ring now spins `.sb::before` (mock-bridge.css, task 3), not `.sb`
  // itself -- setting `.sb`'s own inline style is inert against a build at or
  // after that commit. A runtime stylesheet rule reaches both the pseudo-
  // element (current) and `.sb` (older exes still measured with this script),
  // so this stays a valid "ring stopped" control either way.
  ["noStarspin", () => {
    const style = document.createElement("style");
    style.textContent = ".btn.primary .sb, .btn.primary .sb::before { animation: none !important; }";
    document.head.appendChild(style);
  }],
  ["noCssAnimations", () => document.getAnimations().forEach((a) => a.pause())],
  ["noRaf", () => { window.requestAnimationFrame = () => 0; }],
  ...[".sec", ".pcard", ".console", ".hud-nav", ".actbar"].map((sel) => [
    `noBlur${sel.replace(/\W/g, "")}`,
    backdropOffToggle(sel),
  ]),
];

const ATTRIBUTION_GPU_SECONDS = 15;
const ATTRIBUTION_RAF_MS = 5000;
const ATTRIBUTION_RECALC_MS = 15000;
const ATTRIBUTION_WINDOW_STATE_MS = 5000;

/** One cumulative step: apply its toggle (if any -- "normal" has none), then
 * take the three measurements the plan asks for, in this order (each window
 * is independent, so order does not bias the others). */
async function measureAttributionStep(page, cdp, pids, effect) {
  if (effect) await page.evaluate(effect);

  const gpu = gpuUtilForPids(pids, ATTRIBUTION_GPU_SECONDS);

  await installRafSpy(page);
  await readAndResetRafSpy(page); // discard whatever the toggle itself triggered
  await page.waitForTimeout(ATTRIBUTION_RAF_MS);
  const rafCalls = await readAndResetRafSpy(page);

  const recalcBefore = await metricsMap(cdp);
  await page.waitForTimeout(ATTRIBUTION_RECALC_MS);
  const recalcAfter = await metricsMap(cdp);
  const recalcDelta = diffMetrics(recalcBefore, recalcAfter).RecalcStyleCount ?? null;

  return {
    hasFocus: await page.evaluate(() => document.hasFocus()),
    gpuAvg: gpu.avgPercent,
    gpuMax: gpu.maxPercent,
    rafPerSec: rafCalls / (ATTRIBUTION_RAF_MS / 1000),
    recalcPerSec: recalcDelta === null ? null : recalcDelta / (ATTRIBUTION_RECALC_MS / 1000),
  };
}

/** Minimized/unfocused: rAF attribution by caller stack + which named CSS
 * animations are still running, over a fixed window. Window state is reset
 * to "normal" afterwards so the next probe starts from the same baseline. */
async function measureWindowState(page, cdp, apply, restore) {
  await apply();
  await installRafStackSpy(page);
  await readAndResetRafStackSpy(page);
  await page.waitForTimeout(ATTRIBUTION_WINDOW_STATE_MS);
  const rafBy = await readAndResetRafStackSpy(page);
  const runningAnimations = await runningAnimationNames(page);
  const gate = await windowGateState(page);
  await restore();
  return { rafBy, rafTotal: Object.values(rafBy).reduce((a, b) => a + b, 0), runningAnimations, gate };
}

async function attribution() {
  const real = realProfilePaths();
  const beforeHashes = { paths: real, csdmConfig: sha1(real.csdmConfig), profileConfig: sha1(real.profileConfig) };
  seedIsolatedProfile(JSON.parse(readFileSync(real.csdmConfig, "utf8")));
  const env = { ...process.env, CSDM_REPO_ROOT: WORKTREE_ROOT };
  delete env.PYTHONPATH; delete env.VIRTUAL_ENV; delete env.CSDM_PYTHON_PATH;

  const offscreen = process.env.PERF_OFFSCREEN === "1";
  const out = {
    generatedAt: new Date().toISOString(),
    visible: process.env.PERF_VISIBLE === "1",
    offscreen,
    exePath: EXE_PATH,
    windowStateNote: offscreen
      ? "minimized/unfocused use the REAL BrowserWindow (require('electron').BrowserWindow via the "
        + "exe's own --inspect main-process debugger, includeCommandLineAPI:true -- see "
        + "connectMainProcessInspector). minimized = real .minimize()/.showInactive(); unfocused = "
        + "real .blur() (no inverse called: .focus() could steal the user's real input focus, and "
        + "blur() itself did not move document.hasFocus() either -- see the audit for why)."
      : "minimized/unfocused are proxies, not a literal OS minimize/blur: "
        + "Browser.getWindowForTarget/setWindowBounds are not exposed on this exe's "
        + "--remote-debugging-port endpoint (confirmed by hand, page- and browser-level "
        + "CDP sessions both answered \"wasn't found\"), and CSDM_E2E_BACKGROUND=1 never "
        + "shows a window in the first place (main.js: show:false, backgroundThrottling:false) "
        + "so there is nothing to minimize anyway. minimized = Page.setWebLifecycleState(\"frozen\"); "
        + "unfocused = Emulation.setFocusEmulationEnabled(enabled:false).",
  };

  // ── Cumulative steps, one launch ──────────────────────────────────────
  {
    const { page, mainPid, close } = await launchPackagedExe(env);
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      await switchTab(page, "capture");
      await page.waitForTimeout(5000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const pids = [mainPid, ...getProcessTree(mainPid).map((p) => p.ProcessId)];

      out.focusAtStart = await windowGateState(page);

      // Criterion 1 is per tab: same GPU/rAF windows as the steps below, on
      // each tab, before any toggle is applied.
      out.perTab = [];
      for (const tabId of TABS) {
        await switchTab(page, tabId);
        await page.waitForTimeout(1500); // past the Backdrop's idle settle delay
        const gpu = gpuUtilForPids(pids, ATTRIBUTION_GPU_SECONDS);
        await installRafSpy(page);
        await readAndResetRafSpy(page);
        await page.waitForTimeout(ATTRIBUTION_RAF_MS);
        const rafPerSec = (await readAndResetRafSpy(page)) / (ATTRIBUTION_RAF_MS / 1000);
        // A focus loss during the window would close the motion gate and fake
        // a low reading on the "after" exe -- record it next to the number.
        const { hasFocus } = await windowGateState(page);
        out.perTab.push({ tab: tabId, gpuAvg: gpu.avgPercent, gpuMax: gpu.maxPercent, rafPerSec, hasFocus });
        console.log(`[perf-attribution] tab ${tabId}: gpu ${gpu.avgPercent}% rAF/s ${rafPerSec}`);
      }
      await switchTab(page, "capture");
      await page.waitForTimeout(1500);

      out.steps = [];
      for (const [name, effect] of ATTRIBUTION_STEPS) {
        console.log(`[perf-attribution] step ${name}`);
        const measured = await measureAttributionStep(page, cdp, pids, effect);
        out.steps.push({ name, ...measured });
      }
    } finally {
      await close();
    }
  }

  // ── Window-state probes, fresh launch ─────────────────────────────────
  {
    seedIsolatedProfile(JSON.parse(readFileSync(real.csdmConfig, "utf8")));
    const { page, inspector, close } = await launchPackagedExe(env);
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      await switchTab(page, "capture");
      await page.waitForTimeout(5000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Page.enable");

      // PERF_OFFSCREEN=1 gives a real BrowserWindow via the main-process
      // inspector -- use the actual product methods instead of CDP proxies.
      // `showInactive()` both un-minimizes AND restores visibility without
      // ever requesting OS input focus (confirmed by hand: isMinimized()
      // flips back to false, rAF resumes at full rate) -- `restore()`/
      // `focus()` are deliberately never called, so this can never steal the
      // user's real keyboard focus even though the window technically exists.
      const visibleMode = out.visible && !offscreen;
      out.focusAtStartWindowProbes = await windowGateState(page);
      const refocus = async () => {
        await inspector.eval(`(() => { const w = ${MAIN_WINDOW_EXPR}; if (w.isMinimized()) w.restore(); w.show(); w.focus(); })()`);
        await page.waitForTimeout(1500);
      };

      console.log(`[perf-attribution] minimized (${inspector ? "real BrowserWindow.minimize()" : "proxy: Page.setWebLifecycleState"})`);
      out.minimized = await measureWindowState(
        page, cdp,
        () => (inspector ? inspector.eval(`${MAIN_WINDOW_EXPR}.minimize()`) : setPageLifecycleState(cdp, "frozen")),
        () => (visibleMode ? refocus()
          : inspector ? inspector.eval(`${MAIN_WINDOW_EXPR}.showInactive()`) : setPageLifecycleState(cdp, "active")),
      );
      if (visibleMode) out.afterMinimizeRestore = await windowGateState(page);

      // Visible mode: a real OS focus change -- a second, ordinary window is
      // opened in front of the app and given focus, so the app window loses
      // activation exactly as it would behind another program. Offscreen
      // mode keeps blur(): it must never take the user's focus.
      console.log(`[perf-attribution] unfocused (${visibleMode ? "real: another window focused in front" : inspector ? "real BrowserWindow.blur()" : "proxy: Emulation.setFocusEmulationEnabled"})`);
      out.unfocused = await measureWindowState(
        page, cdp,
        () => (visibleMode
          ? inspector.eval("(() => { const { BrowserWindow } = require('electron'); "
            + "const w = new BrowserWindow({ width: 640, height: 400, show: true, title: 'perf-unfocus' }); "
            + "w.loadURL('about:blank'); w.focus(); globalThis.__perfUnfocus = w; })()")
            .then(() => page.waitForTimeout(1000))
          : inspector ? inspector.eval(`${MAIN_WINDOW_EXPR}.blur()`) : setFocusEmulation(cdp, false)),
        // Offscreen: blur() has no real inverse that cannot risk requesting
        // focus back (focus() could pull OS input focus away from the user).
        () => (visibleMode
          ? inspector.eval("globalThis.__perfUnfocus.destroy()").then(refocus)
          : inspector ? Promise.resolve() : setFocusEmulation(cdp, true)),
      );
      if (visibleMode) out.afterRefocus = await windowGateState(page);

      console.log("[perf-attribution] reduced motion");
      await installRafSpy(page);
      await readAndResetRafSpy(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await page.waitForTimeout(ATTRIBUTION_WINDOW_STATE_MS);
      const rafOn = await readAndResetRafSpy(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await page.waitForTimeout(ATTRIBUTION_WINDOW_STATE_MS);
      const rafOff = await readAndResetRafSpy(page);
      out.reducedMotion = { rafOn, rafOff };
    } finally {
      await close();
    }
  }

  out.realProfileVerification = verifyRealProfileUntouched(beforeHashes);
  mkdirSync(RUN_OUTPUT_DIR, { recursive: true });
  const outFile = path.join(RUN_OUTPUT_DIR, "attribution.json");
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[perf-attribution] wrote ${outFile}`);
  console.log(`[perf-attribution] real profile untouched: ${out.realProfileVerification.ok}`);
  if (!out.realProfileVerification.ok) {
    console.error("[perf-attribution] REAL PROFILE CHANGED -- investigate before trusting any measurement above");
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Variants mode (fix perf 2/2, task 5): idle cost of candidate stylesheets
//  injected at RUNTIME only -- no source file is touched, nothing survives
//  the launch. PERF_VARIANTS=<json file> runs only this. The file is an
//  array of { id, css } (css null = the build as shipped). Each variant is
//  measured on the CAPTURE tab with the same windows as attribution mode,
//  PERF_VARIANT_PASSES times, and the primary button is photographed with
//  every animation frozen at the same instants so variants compare pixel
//  for pixel (the ring is a conic gradient: same angle = same picture).
// ═══════════════════════════════════════════════════════════════════════
const VARIANT_FREEZE_MS = [0, 1300]; // start and half of the 2.6 s ring period
const VARIANT_PASSES = Number(process.env.PERF_VARIANT_PASSES || 2);

async function freezeAnimationsAt(page, ms) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      try { a.pause(); a.currentTime = t; } catch { /* finished one-shot */ }
    }
  }, ms);
}

async function variants() {
  const variantList = JSON.parse(readFileSync(process.env.PERF_VARIANTS, "utf8"));
  const real = realProfilePaths();
  const beforeHashes = { paths: real, csdmConfig: sha1(real.csdmConfig), profileConfig: sha1(real.profileConfig) };
  seedIsolatedProfile(JSON.parse(readFileSync(real.csdmConfig, "utf8")));
  const env = { ...process.env, CSDM_REPO_ROOT: WORKTREE_ROOT };
  delete env.PYTHONPATH; delete env.VIRTUAL_ENV; delete env.CSDM_PYTHON_PATH;
  mkdirSync(RUN_OUTPUT_DIR, { recursive: true });

  const out = {
    generatedAt: new Date().toISOString(),
    visible: process.env.PERF_VISIBLE === "1",
    offscreen: process.env.PERF_OFFSCREEN === "1",
    exePath: EXE_PATH,
    passes: VARIANT_PASSES,
    results: [],
  };
  const { page, mainPid, close } = await launchPackagedExe(env);
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await switchTab(page, "capture");
    await page.waitForTimeout(5000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const pids = [mainPid, ...getProcessTree(mainPid).map((p) => p.ProcessId)];
    out.focusAtStart = await windowGateState(page);
    const button = page.locator(".btn.primary").first();

    for (let pass = 0; pass < VARIANT_PASSES; pass += 1) {
      for (const variant of variantList) {
        console.log(`[perf-variants] pass ${pass + 1} ${variant.id}`);
        const tag = variant.css ? await page.addStyleTag({ content: variant.css }) : null;
        await page.mouse.move(5, 5); // cursor away from the button: rest state
        await page.waitForTimeout(1500);
        const measured = await measureAttributionStep(page, cdp, pids, null);
        if (tag) await tag.evaluate((el) => el.remove()).catch(() => {});
        out.results.push({ pass: pass + 1, id: variant.id, css: variant.css, ...measured });
      }
    }

    // Photographs LAST: freezing goes through the Web Animations API, and once
    // pause()/play() has been called on a CSS animation its CSS
    // animation-play-state no longer applies -- a later "paused at rest"
    // variant would be measured still spinning (seen in the first run).
    out.shots = {};
    for (const variant of variantList) {
      const tag = variant.css ? await page.addStyleTag({ content: variant.css }) : null;
      await page.waitForTimeout(300);
      out.shots[variant.id] = [];
      for (const ms of VARIANT_FREEZE_MS) {
        await freezeAnimationsAt(page, ms);
        const file = path.join(RUN_OUTPUT_DIR, `${variant.id}-t${ms}.png`);
        await button.screenshot({ path: file, animations: "allow" });
        // Same instant with the drifting Backdrop canvas hidden: the only
        // pixels left to differ between variants are the button's own.
        const hideBackdrop = await page.addStyleTag({ content: ".shell-backdrop { visibility: hidden !important; }" });
        const bareFile = path.join(RUN_OUTPUT_DIR, `${variant.id}-t${ms}-nobg.png`);
        await button.screenshot({ path: bareFile, animations: "allow" });
        await hideBackdrop.evaluate((el) => el.remove()).catch(() => {});
        out.shots[variant.id].push(path.basename(file), path.basename(bareFile));
      }
      if (tag) await tag.evaluate((el) => el.remove()).catch(() => {});
    }
  } finally {
    await close();
  }
  out.realProfileVerification = verifyRealProfileUntouched(beforeHashes);
  const outFile = path.join(RUN_OUTPUT_DIR, "variants.json");
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[perf-variants] wrote ${outFile}; real profile untouched: ${out.realProfileVerification.ok}`);
  if (!out.realProfileVerification.ok) process.exitCode = 1;
}

if (process.env.PERF_PROBE === "1") {
  probe().catch((error) => { console.error("[perf-probe] FAILED:", error); process.exitCode = 1; });
} else if (process.env.PERF_VARIANTS) {
  variants().catch((error) => { console.error("[perf-variants] FAILED:", error); process.exitCode = 1; });
} else if (process.env.PERF_ATTRIBUTION === "1") {
  attribution().catch((error) => { console.error("[perf-attribution] FAILED:", error); process.exitCode = 1; });
} else main().catch((error) => {
  console.error("[perf-baseline] FAILED:", error);
  process.exitCode = 1;
});
