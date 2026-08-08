/**
 * Live diagnostic: launch the real window and inspect the block grid as the
 * user sees it. Prints evidence, not assumptions.
 */
import { _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import { mkdirSync } from "node:fs";

const ELECTRON_DIR = process.cwd();
const OUT = path.join(ELECTRON_DIR, "e2e", "output");
mkdirSync(OUT, { recursive: true });

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0];

const app = await electron.launch({
  args: [ELECTRON_DIR],
  cwd: ELECTRON_DIR,
  timeout: 30000,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, CSDM_PYTHON_PATH: "csdm-e2e-no-engine" },
});
const page = await app.firstWindow({ timeout: 30000 });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(1500);

// 1. Screenshot of capture tab
await page.screenshot({ path: path.join(OUT, "diag-capture.png") });

// 2. DOM / computed style evidence
const evidence = await page.evaluate(() => {
  const bento = document.querySelector(".bento");
  const secs = [...document.querySelectorAll(".bento .sec")];
  const gridStyle = bento ? getComputedStyle(bento) : null;
  const htmlBlock = getComputedStyle(document.documentElement).getPropertyValue("--block").trim();
  const bg = bento ? getComputedStyle(bento).backgroundImage : "none";
  return {
    bentoExists: !!bento,
    bentoDisplay: gridStyle?.display ?? null,
    gridCols: gridStyle?.gridTemplateColumns ?? null,
    gridAutoRows: gridStyle?.gridAutoRows ?? null,
    alignItems: gridStyle?.alignItems ?? null,
    alignContent: gridStyle?.alignContent ?? null,
    backgroundImage: bg.slice(0, 120),
    blockVar: htmlBlock,
    cardCount: secs.length,
    cards: secs.map((s) => ({
      title: s.querySelector(".t")?.textContent ?? s.querySelector("h5")?.textContent ?? "(no title)",
      gridCol: getComputedStyle(s).gridColumn,
      gridRow: getComputedStyle(s).gridRow,
      width: Math.round(s.getBoundingClientRect().width),
      height: Math.round(s.getBoundingClientRect().height),
      resizeBtn: !!s.querySelector(".resize-br"),
      dragHandle: !!s.querySelector(".drag-handle"),
    })),
  };
});
console.log("=== GRID EVIDENCE ===");
console.log(JSON.stringify(evidence, null, 2));

// 3. Drag simulation: mousedown on first drag handle, move, release
const dragResult = await page.evaluate(async () => {
  const handle = document.querySelector(".drag-handle");
  if (!handle) return { error: "no drag handle" };
  const handleBox = handle.getBoundingClientRect();
  const startX = handleBox.left + handleBox.width / 2;
  const startY = handleBox.top + handleBox.height / 2;
  handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: startX, clientY: startY }));
  // move to a different cell
  const bento = document.querySelector(".bento");
  const b = bento.getBoundingClientRect();
  const targetX = b.left + 300;
  const targetY = b.top + 300;
  window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: targetX, clientY: targetY }));
  await new Promise((r) => setTimeout(r, 50));
  const ghostDuring = !!document.querySelector(".card-ghost");
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  return { ghostDuring, ghostAfter: !!document.querySelector(".card-ghost") };
});
console.log("=== DRAG SIM ===");
console.log(JSON.stringify(dragResult, null, 2));

// 4. Resize simulation: mousedown on resize-br, move, release
const resizeResult = await page.evaluate(async () => {
  const btn = document.querySelector(".resize-br");
  if (!btn) return { error: "no resize-br" };
  const box = btn.getBoundingClientRect();
  const startX = box.left + box.width / 2;
  const startY = box.top + box.height / 2;
  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: startX, clientY: startY }));
  const bento = document.querySelector(".bento");
  const b = bento.getBoundingClientRect();
  window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: b.left + 600, clientY: b.top + 400 }));
  await new Promise((r) => setTimeout(r, 50));
  const ghostDuring = !!document.querySelector(".card-ghost");
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  const firstCard = document.querySelector(".bento .sec");
  return {
    ghostDuring,
    newGridCol: firstCard ? getComputedStyle(firstCard).gridColumn : null,
    newGridRow: firstCard ? getComputedStyle(firstCard).gridRow : null,
  };
});
console.log("=== RESIZE SIM ===");
console.log(JSON.stringify(resizeResult, null, 2));

await app.close();
await server.close();
console.log("DONE");
