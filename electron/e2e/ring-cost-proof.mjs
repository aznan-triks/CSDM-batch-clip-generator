/**
 * Primary-button ring (StarBorder `.sb`) idle cost -- trace bench + frame identity.
 *
 *   node e2e/ring-cost-proof.mjs trace   [label]   -> output/fix-idle-ring-cost/trace-<label>.json
 *   node e2e/ring-cost-proof.mjs frames  [label]   -> output/fix-idle-ring-cost/frames-<label>/t<ms>.png
 *   node e2e/ring-cost-proof.mjs diff    <a> <b>   -> pixel diff of frames-<a> vs frames-<b>
 *   RING_VARIANTS=<json file of [{id, css}]> trace  -> one trace per injected-CSS variant, same launch
 *
 * WHY NOT A PLAIN HIDDEN WINDOW: CSDM_E2E_BACKGROUND=1 creates the window with
 * show:false, and a never-shown window gets almost no BeginFrames (measured:
 * ~3 compositor frames/s, the ring's compositor animation barely ticks), so a
 * trace of it says nothing about the idle cost. Headless Chromium does tick at
 * 60 Hz but its display skips every draw that has no consumer ("Draw
 * skipped"), so it under-reports too. What this bench does instead: the same
 * dev Electron build, created hidden (CSDM_E2E_BACKGROUND=1), then -- from the
 * main process -- taken off the taskbar, parked entirely outside the union of
 * every display, and shown with showInactive() (never focus()). Native window
 * occlusion is disabled by switch, otherwise Chromium treats an off-display
 * window as occluded and throttles it like a hidden one. Nothing is ever on
 * the user's screen and input focus is never requested; the launch is refused
 * (killed) if either check fails.
 *
 * What is measured is Chromium's own trace (per second, over TRACE_SECONDS):
 * frames the display compositor actually drew (DirectRenderer::DrawFrame),
 * render passes drawn, quads drawn by material (a kAggregatedRenderPass quad
 * is a render surface -- e.g. a backdrop-filter pane -- being composited),
 * main-thread Paint / UpdateLayoutTree / raster tasks, and the render-surface
 * count cc builds per frame. GPU utilisation % is NOT reported: Windows' GPU
 * Engine counter for an off-display window does not reflect the visible-window
 * cost the user sees (no DWM composition of the window), so only the relative
 * trace counters are meaningful here.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { _electron as electron } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createServer } from "vite";

import { CONFIG, ELECTRON_DIR, SHOT_DIR } from "./config.mjs";

const OUT = path.join(SHOT_DIR, "fix-idle-ring-cost");
const TRACE_SECONDS = Number(process.env.TRACE_SECONDS || 4);
const SETTLE_MS = 4000;
const RING_PERIOD_MS = 2600; // starspin / starspin-rotate duration in the theme
const PHASES = Array.from({ length: 13 }, (_, i) => Math.round((i * RING_PERIOD_MS) / 12)); // 0..2600
const CATEGORIES = [
  "devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz", "benchmark",
  "disabled-by-default-viz.quads", ...(process.env.RING_EXTRA_CATS ? process.env.RING_EXTRA_CATS.split(",") : []),
].join(",");
const OFFSCREEN_MARGIN_PX = 2000;

async function launchOffscreen() {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts"), logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) { await server.close(); throw new Error("Vite reported no local URL"); }
  const app = await electron.launch({
    args: [ELECTRON_DIR, "--disable-features=CalculateNativeWinOcclusion"],
    cwd: ELECTRON_DIR,
    timeout: CONFIG.launchTimeoutMs,
    env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine", CSDM_E2E_BACKGROUND: "1" },
  });
  const close = async () => { await app.close().catch(() => {}); await server.close(); };
  const page = await app.firstWindow({ timeout: CONFIG.launchTimeoutMs });
  const check = await app.evaluate(({ BrowserWindow, screen }, { margin, size }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const displays = screen.getAllDisplays().map((d) => d.bounds);
    const minX = Math.min(...displays.map((d) => d.x));
    const minY = Math.min(...displays.map((d) => d.y));
    w.setSkipTaskbar(true);
    w.setContentSize(size.width, size.height);
    const b = w.getBounds();
    w.setPosition(minX - margin - b.width, minY - margin - b.height);
    w.showInactive();
    const a = w.getBounds();
    const hit = displays.some((d) => a.x < d.x + d.width && a.x + a.width > d.x && a.y < d.y + d.height && a.y + a.height > d.y);
    return { onAnyDisplay: hit, focused: BrowserWindow.getFocusedWindow() === w, bounds: a };
  }, { margin: OFFSCREEN_MARGIN_PX, size: CONFIG.viewport });
  if (check.onAnyDisplay || check.focused) {
    await close();
    throw new Error(`offscreen safety check failed, refusing to measure: ${JSON.stringify(check)}`);
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector(".btn.primary .sb");
  await page.waitForTimeout(SETTLE_MS);
  return { app, page, close, check, pids: appPids(app.process().pid) };
}

const GPU_SECONDS = Number(process.env.GPU_SECONDS || 8);

/** Every process of this Electron launch (main + GPU + renderer + utility). */
function appPids(rootPid) {
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId | ConvertTo-Json -Compress"], { encoding: "utf8" });
  const rows = JSON.parse(out);
  const pids = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (pids.has(r.ParentProcessId) && !pids.has(r.ProcessId)) { pids.add(r.ProcessId); grew = true; }
  }
  return [...pids];
}

/** Windows `GPU Engine` utilisation summed over this launch's PIDs (same
 * counter and PID matching as perf-baseline.mjs gpuUtilForPids). Off-display
 * window: Chromium's own GPU work (raster, blur, composite, present) is real,
 * DWM's composition of the window onto a screen is not included. */
function gpuUtil(pids, seconds) {
  const script = String.raw`$p=@(${pids.join(",")}); $s=Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds} -ErrorAction SilentlyContinue; `
    + String.raw`$tot=@(); foreach($set in $s){ $sum=0; foreach($c in $set.CounterSamples){ if($c.InstanceName -match 'pid_(\d+)_'){ if($p -contains [int]$Matches[1]){ $sum+=$c.CookedValue } } }; $tot+=$sum }; `
    + String.raw`$m=($tot | Measure-Object -Average -Maximum); [string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0:F2} {1:F2}',$m.Average,$m.Maximum)`;
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
  const [avg, max] = out.split(/\s+/).map(Number);
  return { avg, max };
}

async function trace(page, css, pids) {
  const styleHandle = css ? await page.addStyleTag({ content: css }) : null;
  await page.waitForTimeout(800);
  const gpu = pids && GPU_SECONDS > 0 ? gpuUtil(pids, GPU_SECONDS) : null;
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on("Tracing.dataCollected", (p) => events.push(...p.value));
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", { categories: CATEGORIES, transferMode: "ReportEvents" });
  await page.waitForTimeout(TRACE_SECONDS * 1000);
  await cdp.send("Tracing.end");
  await done;
  await cdp.detach();
  if (styleHandle) await styleHandle.evaluate((n) => n.remove());
  if (process.env.RING_RAW) writeFileSync(process.env.RING_RAW, JSON.stringify(events));
  return { gpuPercentOffDisplay: gpu, ...summarise(events) };
}

function summarise(events) {
  const per = (n) => +(events.filter((e) => e.name === n && e.ph !== "E").length / TRACE_SECONDS).toFixed(1);
  const quads = {};
  for (const e of events) {
    if (e.name === "SkiaRenderer::DoDrawQuad") quads[e.args.material] = (quads[e.args.material] || 0) + 1;
  }
  for (const k of Object.keys(quads)) quads[k] = +(quads[k] / TRACE_SECONDS).toFixed(1);
  const surfaces = events.filter((e) => e.name === "LayerTreeHostImpl::CalculateRenderPasses").map((e) => e.args["render_surface_list_size()"]);
  const drawDurUs = events.filter((e) => e.name === "DirectRenderer::DrawFrame" && e.dur).reduce((s, e) => s + e.dur, 0);
  // Per drawn frame: which render passes were redrawn (id:quads) -- tells a
  // local redraw (1 small pass) from a whole-window recomposite (every pass).
  const frames = events.filter((e) => e.name === "DirectRenderer::DrawFrame" && e.dur);
  const passes = events.filter((e) => e.name === "DirectRenderer::DrawRenderPass");
  const shapes = {};
  for (const f of frames) {
    const k = passes.filter((p) => p.tid === f.tid && p.ts >= f.ts && p.ts <= f.ts + f.dur).map((p) => `${p.args.id}:${p.args.NumberOfQuads}`).join(" ");
    shapes[k] = (shapes[k] || 0) + 1;
  }
  return {
    perSecond: {
      compositorFramesSubmitted: per("Display::DrawAndSwap"),
      framesDrawn: per("DirectRenderer::DrawFrame"),
      renderPassesDrawn: per("DirectRenderer::DrawRenderPass"),
      renderSurfaceQuadsDrawn: quads.kAggregatedRenderPass || 0,
      quadsDrawn: Object.values(quads).reduce((s, n) => s + n, 0),
      paint: per("Paint"),
      styleRecalc: per("UpdateLayoutTree"),
      rasterTasks: per("RasterTask"),
      layerTreeCommits: per("Commit"),
      animationTicks: per("AnimationHost::TickAnimations"),
      rAF: per("FireAnimationFrame"),
    },
    quadsByMaterialPerSecond: quads,
    renderSurfacesPerFrame: surfaces.length ? Math.max(...surfaces) : null,
    vizDrawMsPerSecond: +(drawDurUs / 1000 / TRACE_SECONDS).toFixed(2),
    drawnFrameShapes: Object.fromEntries(Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 6)),
  };
}

async function frames(page, dir) {
  mkdirSync(dir, { recursive: true });
  const box = await page.evaluate(() => {
    // Hold everything still so only the ring's phase varies; hide the pointer-
    // following cursor and the animated backdrop canvas, which would otherwise
    // differ between two shots for reasons unrelated to the ring.
    for (const a of document.getAnimations()) a.pause();
    for (const c of document.querySelectorAll("canvas")) c.style.visibility = "hidden";
    return document.querySelector(".btn.primary").getBoundingClientRect().toJSON();
  });
  const clip = { x: Math.floor(box.x) - 10, y: Math.floor(box.y) - 10, width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 };
  for (const t of PHASES) {
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) {
        if (/^starspin/.test(a.animationName)) a.currentTime = ms;
      }
    }, t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(dir, `t${String(t).padStart(4, "0")}.png`), clip, animations: "allow" });
  }
  return clip;
}

function diff(a, b) {
  const rows = [];
  for (const t of PHASES) {
    const name = `t${String(t).padStart(4, "0")}.png`;
    const A = PNG.sync.read(readFileSync(path.join(OUT, `frames-${a}`, name)));
    const B = PNG.sync.read(readFileSync(path.join(OUT, `frames-${b}`, name)));
    if (A.width !== B.width || A.height !== B.height) { rows.push({ t, error: "size mismatch" }); continue; }
    const out = new PNG({ width: A.width, height: A.height });
    const strict = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0, includeAA: true });
    const loose = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.1 });
    let maxChannel = 0;
    for (let i = 0; i < A.data.length; i++) maxChannel = Math.max(maxChannel, Math.abs(A.data[i] - B.data[i]));
    mkdirSync(path.join(OUT, `diff-${a}-vs-${b}`), { recursive: true });
    writeFileSync(path.join(OUT, `diff-${a}-vs-${b}`, name), PNG.sync.write(out));
    rows.push({ t, pixels: A.width * A.height, diffStrict: strict, diffLoose: loose, maxChannelDelta: maxChannel });
  }
  return rows;
}

const [mode = "trace", label = "current", other] = process.argv.slice(2);
if (mode === "diff") {
  const rows = diff(label, other);
  writeFileSync(path.join(OUT, `diff-${label}-vs-${other}.json`), JSON.stringify(rows, null, 2));
  console.table(rows);
} else {
  const { page, close, check, pids } = await launchOffscreen();
  try {
    if (mode === "frames") {
      const clip = await frames(page, path.join(OUT, `frames-${label}`));
      console.log("frames written", clip);
    } else {
      const variants = process.env.RING_VARIANTS ? JSON.parse(readFileSync(process.env.RING_VARIANTS, "utf8")) : [{ id: label, css: null }];
      const passes = Number(process.env.RING_PASSES || 1);
      const results = [];
      for (let p = 1; p <= passes; p++) {
        for (const v of variants) {
          const r = await trace(page, v.css, pids);
          results.push({ pass: p, id: v.id, css: v.css, ...r });
          console.log(v.id, "gpu%", JSON.stringify(r.gpuPercentOffDisplay), JSON.stringify(r.perSecond), "surfaces", r.renderSurfacesPerFrame, "vizDrawMs/s", r.vizDrawMsPerSecond);
        }
      }
      writeFileSync(path.join(OUT, `trace-${label}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), window: check, traceSeconds: TRACE_SECONDS, results }, null, 2));
    }
  } finally { await close(); }
}
