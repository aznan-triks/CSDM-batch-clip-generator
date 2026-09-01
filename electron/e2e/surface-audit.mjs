/**
 * Phase 3 of the 2026-09-01 audit: measure the four shared surfaces, in the
 * real window, at real widths.
 *
 * Why measured rather than read. CONTEXT_GUIDE section 10 records four separate
 * occasions where the stylesheet said one thing and the rendered page did
 * another -- a shorthand beating the rule meant to fix it, a `calc()` that is
 * valid syntax and invalid at computation, a `grid-area` inventing implicit
 * rows. A grep produces suspects here, never verdicts. So every number below
 * comes from `getBoundingClientRect` / `getComputedStyle` on the live page.
 *
 * Four questions, one per reported symptom:
 *   C1  which close/remove controls exist, and do they agree with each other
 *   C2  which rows spill out of their card, at which widths
 *   C3  on which tabs, over which surfaces, does the crosshair appear
 *   C4  which labels sit far from the control they name, and by how much
 *
 * Usage: node electron/e2e/surface-audit.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "audits", "surface");
const SHOT_DIR = path.join(OUT_DIR, "shots");

/**
 * HC.1 -- every fixed value this script uses, named once.
 *
 * `widths`  : the real range a card is dragged through. 1440 is a maximised
 *   window on this machine; 820 is the narrowest the shell still lays out.
 *   The reported symptom is "when the card is not the right size", so the
 *   sweep has to include sizes the user actually reaches.
 * `tabs`    : the five panels, by the label the nav shows.
 * `slackPx` : sub-pixel rounding. A one-pixel overhang is a rounding artefact,
 *   not a design fault; anything past it is real.
 * `labelGapPx` : how far a label's text may sit from the end of its own box
 *   before it reads as detached. "TK" against a 76px box leaves ~55px.
 */
const AUDIT = {
  widths: [1440, 1180, 980, 820],
  height: 900,
  tabs: ["CAPTURE", "EDITING", "TAGS", "VIDEO", "SETTINGS"],
  slackPx: 1,
  labelGapPx: 12,
  settleMs: 500,
  engineTimeoutMs: 30_000,
  /**
   * Where the console splitter is dragged, as a fraction of the window.
   * `narrow` sits on `SPLIT_PCT_RANGE.min` (38), the tightest the content
   * column is allowed to get and the state the symptom describes.
   */
  splits: { narrow: 0.38, default: 0.6, wide: 0.8 },
};

/** Drag the console splitter so the content column takes `fraction` of the window. */
async function dragSplit(page, width, fraction) {
  const handle = page.locator(".split-handle").first();
  const box = await handle.boundingBox().catch(() => null);
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(Math.round(width * fraction), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(AUDIT.settleMs);
}

function save(name, text) {
  const file = path.join(OUT_DIR, name);
  writeFileSync(file, text, "utf8");
  console.log(`  → ${path.relative(REPO_ROOT, file)}`);
}

async function openTab(page, label) {
  await page.locator(`.tab:has-text("${label}")`).first().click();
  await page.waitForTimeout(AUDIT.settleMs);
}

/* ------------------------------------------------------------------ C1 --- */

/**
 * Every control that closes, removes, unchecks or clears something.
 *
 * Collected two ways at once, because either alone misses half of them: by
 * CLASS (a name containing del/remove/close/clear/uncheck) and by GLYPH (the
 * visible text being a cross). `ps-chip-del` has the class and the glyph;
 * DemoPicker's "✕ Uncheck all" has the glyph inside a longer label and no
 * class at all.
 */
function collectCloseControls(tabLabel) {
  const CROSSES = ["×", "✕", "✖", "✗", "⨯", "✘"];
  const NAME = /(^|[-_ ])(del|delete|remove|close|clear|uncheck)([-_ ]|$)/i;
  const seen = [];
  for (const el of document.querySelectorAll("button, [role='button'], a[href='#']")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // in a hidden panel
    const text = (el.textContent ?? "").trim();
    const cls = el.className && typeof el.className === "string" ? el.className : "";
    const hasCross = CROSSES.some((c) => text.includes(c));
    if (!hasCross && !NAME.test(cls)) continue;
    const style = getComputedStyle(el);
    seen.push({
      tab: tabLabel,
      text,
      className: cls,
      glyph: CROSSES.find((c) => text.includes(c)) ?? "(none)",
      isGlyphOnly: CROSSES.includes(text),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      color: style.color,
      background: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      padding: style.padding,
      title: el.getAttribute("title") ?? "",
      dataAction: el.getAttribute("data-action") ?? "",
    });
  }
  return seen;
}

/* ------------------------------------------------------------------ C2 --- */

/**
 * Rows that reach past their own card.
 *
 * Two different failures, measured separately because they have different
 * causes: `overflowPx` is content wider than its scroll box (the row itself
 * cannot fit), `spillPx` is a box drawn past its card's right edge (the row
 * fits but was placed outside). The reported symptom -- buttons half hidden --
 * is the second.
 */
function collectOverflow([width, slackPx, splitLabel]) {
  const out = [];
  // The card is `.sec` -- the approved mock's own name. The first version of
  // this script scanned `.card`, found zero elements and reported zero
  // overflow: a clean bill of health from a selector that matched nothing,
  // which is the same failure the reticle's stale denylist was (section 10).
  const cards = document.querySelectorAll(".sec");
  for (const card of cards) {
    const cardRect = card.getBoundingClientRect();
    if (cardRect.width === 0) continue;
    const title = (card.querySelector(".t")?.textContent ?? "").trim();
    const style = getComputedStyle(card);
    const innerRight = cardRect.right - parseFloat(style.paddingRight || "0");
    for (const el of card.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const overflowPx = Math.round(el.scrollWidth - el.clientWidth);
      const spillPx = Math.round(rect.right - innerRight);
      if (overflowPx <= slackPx && spillPx <= slackPx) continue;
      out.push({
        width,
        split: splitLabel,
        card: title || "(untitled card)",
        cardWidth: Math.round(cardRect.width),
        element: `${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").split(" ").filter(Boolean).join(".")}`,
        text: (el.textContent ?? "").trim().slice(0, 40),
        overflowPx: overflowPx > slackPx ? overflowPx : 0,
        spillPx: spillPx > slackPx ? spillPx : 0,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ C4 --- */

/**
 * Labels whose text stops well short of the end of their own box.
 *
 * Measured with a Range around the text node -- `offsetWidth` is the box and
 * says nothing about where the ink ends, which is exactly the difference the
 * symptom is about ("TK is too far from its category").
 */
function collectLabelGaps([tabLabel, minGapPx]) {
  const out = [];
  for (const el of document.querySelectorAll(".lab, .label, label")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    // Only labels that sit BESIDE their control, on one line. A label that is
    // a block above its field stretches to the card by design, and counting
    // it turns 66 rows of noise into the answer -- the symptom is a short word
    // marooned to the LEFT of the thing it names.
    const parentDisplay = getComputedStyle(el.parentElement ?? el).display;
    const beside = parentDisplay.includes("flex") || parentDisplay.includes("grid");
    if (!beside) continue;
    const next = el.nextElementSibling;
    if (!next) continue;
    const nextRect = next.getBoundingClientRect();
    if (nextRect.width === 0 || nextRect.left < rect.right - 1) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const inkWidth = range.getBoundingClientRect().width;
    range.detach?.();
    const gap = Math.round(rect.width - inkWidth);
    if (gap < minGapPx) continue;
    const style = getComputedStyle(el);
    out.push({
      tab: tabLabel,
      text: (el.textContent ?? "").trim().slice(0, 30),
      className: typeof el.className === "string" ? el.className : "",
      boxWidth: Math.round(rect.width),
      inkWidth: Math.round(inkWidth),
      gapPx: gap,
      minWidth: style.minWidth,
      /** Distance from the end of the ink to the control it names. */
      inkToControlPx: Math.round(nextRect.left - (rect.left + inkWidth)),
      next: `${next.tagName.toLowerCase()}.${(typeof next.className === "string" ? next.className : "").split(" ").filter(Boolean).join(".")}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ C3 --- */

/** Where the crosshair is asked to appear, one probe per kind of surface. */
const CURSOR_PROBES = [
  { zone: "panel background", selector: ".scrollwrap" },
  { zone: "card body", selector: ".sec" },
  { zone: "card heading", selector: ".sec .sh" },
  { zone: "chip button", selector: ".chip" },
  { zone: "action button", selector: ".btn" },
  { zone: "text field", selector: "input[type='text'], input:not([type])" },
  { zone: "segmented option", selector: ".seg button" },
];

async function probeCursor(page, tabLabel) {
  const rows = [];
  // Every panel stays mounted (keep-alive), so an unscoped locator reaches
  // into a HIDDEN tab and reports its first match -- which has no box, which
  // reads as "this control does not exist on this tab". Scope to the panel
  // that is actually on screen. `.scrollwrap` is outside the panel, so it is
  // addressed on its own.
  const panel = page.locator('[role="tabpanel"]');
  // Two things live OUTSIDE the panel and must not be scoped to it: the
  // scrolling wrapper that contains the panels, and the action bar, which sits
  // under them for the whole window. Scoping those to the panel reported
  // "this control does not exist on this tab" for a button visible on all five.
  const OUTSIDE_PANEL = [".scrollwrap", ".btn"];
  const scoped = (selector) =>
    (OUTSIDE_PANEL.includes(selector) ? page.locator(selector) : panel.locator(selector));
  for (const probe of CURSOR_PROBES) {
    const target = scoped(probe.selector).first();
    const count = await scoped(probe.selector).count();
    if (count === 0) {
      rows.push({ tab: tabLabel, ...probe, present: false, crosshair: null });
      continue;
    }
    // A control scrolled out of the panel has a box, but nothing is under the
    // pointer at its coordinates -- which reads as "the crosshair did not
    // appear" when the truth is "nothing was there to hover".
    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const box = await target.boundingBox().catch(() => null);
    if (!box || box.width === 0) {
      rows.push({ tab: tabLabel, ...probe, present: false, crosshair: null });
      continue;
    }
    // The background must be probed where the background is actually exposed.
    // A fixed corner lands on a card on the dense tabs and on nothing on the
    // sparse ones, which is how the first run produced a matrix that said more
    // about the probe than about the app. Here the point is SEARCHED: scan the
    // panel until `elementFromPoint` returns the panel itself.
    let point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (probe.zone === "panel background") {
      const found = await page.evaluate(({ sel, b }) => {
        const panel = document.querySelector(sel);
        if (!panel) return null;
        for (let y = b.y + b.height - 8; y > b.y + 8; y -= 24) {
          for (let x = b.x + 8; x < b.x + b.width - 8; x += 40) {
            if (document.elementFromPoint(x, y) === panel) return { x, y };
          }
        }
        return null;
      }, { sel: probe.selector, b: box });
      if (!found) {
        rows.push({ tab: tabLabel, ...probe, present: true, crosshair: "no exposed background" });
        continue;
      }
      point = found;
    }
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(80);
    const [crosshair, under] = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const name = el
        ? `${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").split(" ").filter(Boolean).join(".")}`
        : "(nothing)";
      return [document.body.classList.contains("customcursor"), name];
    }, point);
    rows.push({ tab: tabLabel, ...probe, present: true, crosshair, under });
  }
  return rows;
}

/* ------------------------------------------------------------------------- */

function table(rows, columns) {
  if (rows.length === 0) return "_nothing found_\n";
  const head = `| ${columns.join(" | ")} |`;
  const rule = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`)
    .join("\n");
  return `${head}\n${rule}\n${body}\n`;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const { page, close } = await launchWithEngine();
  const closeControls = [];
  const labelGaps = [];
  const cursorRows = [];
  const overflow = [];

  try {
    console.log(`engine ready: ${await waitForEngine(page, AUDIT.engineTimeoutMs)}`);

    // C1, C3, C4 and the screenshots: at the reference width, tab by tab.
    await page.setViewportSize({ width: AUDIT.widths[0], height: AUDIT.height });
    for (const tab of AUDIT.tabs) {
      await openTab(page, tab);
      closeControls.push(...(await page.evaluate(collectCloseControls, tab)));
      labelGaps.push(...(await page.evaluate(collectLabelGaps, [tab, AUDIT.labelGapPx])));
      cursorRows.push(...(await probeCursor(page, tab)));
      await page.screenshot({ path: path.join(SHOT_DIR, `${tab.toLowerCase()}.png`) });
      console.log(`  ${tab}: measured`);
    }

    // C2: the sweep. Resizing the WINDOW is not enough -- the grid reflows and
    // every card keeps a comfortable width, which is why the first run found
    // nothing. The reported symptom is a card "not at the right size", and the
    // way a user reaches that is the console splitter: dragging it right
    // squeezes the content column to its 38% floor.
    for (const tab of AUDIT.tabs) {
      await openTab(page, tab);
      for (const width of AUDIT.widths) {
        await page.setViewportSize({ width, height: AUDIT.height });
        await page.waitForTimeout(AUDIT.settleMs);
        for (const [splitLabel, fraction] of Object.entries(AUDIT.splits)) {
          await dragSplit(page, width, fraction);
          overflow.push(...(await page.evaluate(
            collectOverflow, [width, AUDIT.slackPx, splitLabel]).catch(() => [])));
          if (tab === "CAPTURE") {
            await page.screenshot({
              path: path.join(SHOT_DIR, `capture-${width}-${splitLabel}.png`) });
          }
        }
      }
      console.log(`  overflow sweep done: ${tab}`);
    }
    await dragSplit(page, AUDIT.widths[0], AUDIT.splits.default);
  } finally {
    await close();
  }

  save("measures.json", JSON.stringify(
    { closeControls, overflow, cursorRows, labelGaps }, null, 2));

  const report = [
    "# Mesures de surface — audit du 2026-09-01",
    "",
    "Relevés pris dans la fenêtre réelle (`node electron/e2e/surface-audit.mjs`).",
    "Aucune valeur ci-dessous ne vient de la lecture d'une feuille de style.",
    "",
    "## C1 — contrôles de fermeture / suppression",
    table(closeControls, ["tab", "text", "className", "glyph", "width", "height",
                          "fontSize", "color", "borderRadius", "padding", "dataAction"]),
    "## C2 — débordements par largeur",
    table(overflow, ["width", "split", "card", "cardWidth", "element", "text", "overflowPx", "spillPx"]),
    "## C3 — matrice du curseur (onglet × zone)",
    table(cursorRows, ["tab", "zone", "selector", "present", "crosshair", "under"]),
    "## C4 — libellés détachés de leur contrôle",
    table(labelGaps, ["tab", "text", "className", "boxWidth", "inkWidth", "gapPx",
                      "inkToControlPx", "minWidth", "next"]),
  ].join("\n");
  save("SURFACE_MEASURES.md", `${report}\n`);
  console.log(`\nC1 ${closeControls.length} · C2 ${overflow.length} · C3 ${cursorRows.length} · C4 ${labelGaps.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
