/**
 * The hover lock (D13, D16, R7). The most important test in this stage.
 *
 * It encodes the lesson of session 2: the cards moved on hover because of a
 * `.card` class inherited from a third-party template, and the check at the
 * time only swept our own rules, so it could not see it.
 *
 * WHY THIS IS A STYLESHEET SCAN AND NOT A COMPUTED-STYLE TEST
 * ----------------------------------------------------------
 * The plan asked for `getComputedStyle(el).transform` on really-rendered,
 * really-hovered elements, and said to decide on evidence. The evidence, from
 * a probe run in this project's own jsdom:
 *
 *     el.matches(':hover')             -> false, always, even after
 *                                         dispatching mouseover/mouseenter
 *     getComputedStyle(el, '::before') -> "Not implemented" (jsdom throws it
 *                                         as an unimplemented feature)
 *
 * jsdom does apply a stylesheet's cascade -- a background does change -- but
 * it has no hover state and no pseudo-element styles at all. A computed-style
 * hover test there would return `transform: none` for EVERY element,
 * including one that genuinely moves. That is a guardrail that detects
 * nothing, which is worse than no guardrail: it reassures wrongly.
 *
 * So this scans the BUILT stylesheet instead -- the one that actually ships.
 * That is a complete sweep rather than a sample, because the page's Content
 * Security Policy forbids remote stylesheets: every rule the app can ever
 * apply is bundled into these files, third-party CSS included. The session-2
 * bug WOULD have been caught here, since that class lived in a stylesheet the
 * page had loaded.
 *
 * What this cannot see: motion applied from JavaScript on a pointer event.
 * The second half of the file covers that by scanning the source.
 * What is still missing: a real browser. See the plan's closing notes.
 *
 * ONE DELIBERATE EXCEPTION TO "every rule the app can ever apply": the
 * approved mock's own extraction (theme/mock-v12.css) legitimately bounces
 * four things on hover, and it cannot be hand-edited to remove that (it is
 * generated and drift-locked, see theme/__tests__/mock-v12.test.ts). A
 * build-time plugin (electron/postcss-strip-mock-hover-motion.mjs, wired
 * into vite.config.ts) strips motion properties from that ONE file's
 * `:hover` rules before this scan ever sees them -- so the sweep below never
 * encounters the mock's hover motion, not because it was told to ignore it,
 * but because the shipped bundle genuinely does not contain it. Every other
 * stylesheet, including every component's own CSS, is untouched by that
 * plugin and stays fully covered by this test.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import type { Declaration, Rule } from "postcss";
import { build } from "vite";
import { describe, expect, it, beforeAll } from "vitest";

import { isMotionProperty } from "../../../scripts/motion-properties.mjs";

const ELECTRON_DIR = path.join(__dirname, "..", "..", "..");
const SOURCE_DIR = path.join(ELECTRON_DIR, "renderer", "src");

/**
 * EMPTY, and it should stay that way.
 *
 * It used to hold `sweep`, the action button's reflection: a gradient on a
 * pseudo-element behind the label, allowlisted because the keyframes
 * translated it. That effect is gone -- the approved mock answers a hover with
 * the `.bx` glitch grid, which animates `clip-path` and moves nothing, and two
 * effects stacked on one gesture read as a bug.
 *
 * Adding a name here is adding a hover animation that MOVES something, so it
 * has to be a deliberate edit with its own guard, never a side effect.
 */
const ALLOWED_HOVER_ANIMATIONS: readonly string[] = [];

/** Build the real bundle in memory, so the scan can never read a stale file. */
async function buildStylesheets(): Promise<{ name: string; css: string }[]> {
  const result = await build({
    configFile: path.join(ELECTRON_DIR, "vite.config.ts"),
    logLevel: "error",
    build: { write: false },
  });

  const outputs = Array.isArray(result) ? result : [result];
  const sheets: { name: string; css: string }[] = [];
  for (const bundle of outputs) {
    // A rollup output bundle; asset chunks carry the CSS.
    const chunks = "output" in bundle ? bundle.output : [];
    for (const chunk of chunks) {
      if (chunk.type === "asset" && chunk.fileName.endsWith(".css")) {
        sheets.push({ name: chunk.fileName, css: String(chunk.source) });
      }
    }
  }
  return sheets;
}

/** Every .ts/.tsx file under renderer/src, recursively. */
function sourceFiles(dir: string = SOURCE_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe("no hover rule in the SHIPPED stylesheet moves anything", () => {
  let sheets: { name: string; css: string }[] = [];

  beforeAll(async () => {
    sheets = await buildStylesheets();
  }, 120_000);

  it("the build actually produced a stylesheet to scan", () => {
    // Without this, an empty bundle would make every assertion below pass
    // vacuously -- the exact failure mode this whole file exists to avoid.
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.some((sheet) => sheet.css.trim().length > 0)).toBe(true);
  });

  it("declares no motion property inside a :hover rule", () => {
    const violations: string[] = [];

    for (const sheet of sheets) {
      postcss.parse(sheet.css).walkRules((rule: Rule) => {
        if (!rule.selector.includes(":hover")) return;
        rule.walkDecls((decl: Declaration) => {
          if (isMotionProperty(decl.prop)) {
            violations.push(`${sheet.name}: ${rule.selector} { ${decl.prop}: ${decl.value} }`);
          }
        });
      });
    }

    expect(violations, `hover rules that move something:\n${violations.join("\n")}`).toEqual([]);
  });

  it("runs no motion keyframes from a :hover rule, except the allowlisted sweep", () => {
    const violations: string[] = [];

    for (const sheet of sheets) {
      const root = postcss.parse(sheet.css);

      // Collect which keyframe names animate a motion property.
      const movingKeyframes = new Set<string>();
      root.walkAtRules(/^(-\w+-)?keyframes$/, (atRule) => {
        let moves = false;
        atRule.walkDecls((decl: Declaration) => {
          if (isMotionProperty(decl.prop)) moves = true;
        });
        if (moves) movingKeyframes.add(atRule.params.trim());
      });

      // Then find hover rules that start one of them.
      root.walkRules((rule: Rule) => {
        if (!rule.selector.includes(":hover")) return;
        rule.walkDecls((decl: Declaration) => {
          if (!/^animation(-name)?$/i.test(decl.prop)) return;
          for (const name of movingKeyframes) {
            if (!new RegExp(`\\b${name}\\b`).test(decl.value)) continue;
            if (ALLOWED_HOVER_ANIMATIONS.includes(name)) continue;
            violations.push(
              `${sheet.name}: ${rule.selector} runs moving keyframes "${name}" via ${decl.prop}`,
            );
          }
        });
      });
    }

    expect(
      violations,
      `hover rules running motion keyframes:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every allowlisted animation on a pseudo-element", () => {
    // An exception is only acceptable while it stays a background effect on a
    // pseudo-element: attached to a real element, the label moves and the
    // exception silently stops being one. The list is empty today, so this
    // passes over nothing -- it is the guard that has to exist BEFORE the next
    // name is added, not after.
    const offenders: string[] = [];

    for (const sheet of sheets) {
      postcss.parse(sheet.css).walkRules((rule: Rule) => {
        if (!rule.selector.includes(":hover")) return;
        rule.walkDecls((decl: Declaration) => {
          if (!/^animation(-name)?$/i.test(decl.prop)) return;
          if (!ALLOWED_HOVER_ANIMATIONS.some((name) => new RegExp(`\\b${name}\\b`).test(decl.value)))
            return;
          // Both `::before` and `:before`: CSS minifiers rewrite the modern
          // double-colon form to the legacy single-colon one. Matching only
          // the double form made this assertion pass vacuously on a minified
          // build -- it saw no allowlisted sweep at all and had nothing to
          // check.
          if (!/::?(before|after)/.test(rule.selector)) {
            offenders.push(`${sheet.name}: ${rule.selector} runs an allowlisted sweep on a real element`);
          }
        });
      });
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/**
 * Files allowed to listen to the pointer. The restyle needs cursor-driven
 * PAINTING (a spotlight that follows the cursor, a backdrop that lights up),
 * which the previous blanket ban made impossible.
 *
 * The ban that matters is unchanged and is enforced below: such a file may
 * write CSS CUSTOM PROPERTIES only. The moment it writes `style.transform` or
 * `style.left`, the label moves and we are back to the bug D13 existed to
 * prevent -- so being on this list buys the right to paint, never the right to
 * move something.
 *
 * `shell/AppShell.tsx` (menus-C follow-up, AUDIT_console_resize_boutons.md):
 * a genuine drag-to-resize handle for the console column, one deliberate
 * `mousemove` listener installed only between its own `mousedown` and
 * `mouseup`. It still writes only `--split-left`/`--split-right` (React
 * `style` prop, custom properties) -- the actual grid width change lives in
 * AppShell.css, reading those properties. Same rule as the paint-only
 * entries, applied to a real (not decorative) interaction.
 */
const CURSOR_DRIVEN_ALLOWLIST: readonly string[] = [
  "shell/AppShell.tsx",
  "shell/Backdrop.tsx",
  "components/Card.tsx",
  "cursor/Reticle.tsx",
];

describe("pointer handlers in the source paint, they never move anything", () => {
  // The stylesheet scan cannot see this: an onMouseEnter that writes
  // `style.transform`, or fires a GSAP tween, never appears in the CSS.
  const POINTER_HANDLERS =
    /on(MouseEnter|MouseOver|MouseMove|PointerEnter|PointerOver)\s*=|addEventListener\(\s*["'](mousemove|mouseover|mouseenter|pointermove)["']/;

  /** Writing a layout style directly. `--foo` custom properties are not this. */
  const WRITES_LAYOUT_STYLE =
    /\.style\s*\.\s*(transform|translate|rotate|scale|top|left|right|bottom|width|height|margin|padding)\b/;
  /** `setProperty` is only acceptable for a custom property. */
  const SETS_NON_CUSTOM_PROPERTY = /setProperty\(\s*["'](?!--)/;
  const RUNS_TWEEN = /\bgsap\s*\.\s*(to|from|fromTo|set)\b|\.animate\s*\(/;

  it("no pointer-handler file writes a layout style, allowlisted or not", () => {
    // This half applies to EVERY file: the allowlist buys the right to paint,
    // not the right to move. A regression here is the session-2 bug returning.
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf-8");
      if (!POINTER_HANDLERS.test(text)) continue;
      if (WRITES_LAYOUT_STYLE.test(text) || SETS_NON_CUSTOM_PROPERTY.test(text) || RUNS_TWEEN.test(text)) {
        violations.push(path.relative(SOURCE_DIR, file).split(path.sep).join("/"));
      }
    }

    expect(
      violations,
      `pointer handlers that move something instead of painting:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("only allowlisted files listen to the pointer at all", () => {
    // Keeps the surface deliberate: a new cursor-driven effect has to be an
    // explicit edit to the list, not a side effect of adding a handler.
    const unexpected: string[] = [];

    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf-8");
      if (!POINTER_HANDLERS.test(text)) continue;
      const relative = path.relative(SOURCE_DIR, file).split(path.sep).join("/");
      if (!CURSOR_DRIVEN_ALLOWLIST.includes(relative)) unexpected.push(relative);
    }

    expect(
      unexpected,
      `files listening to the pointer without being on the allowlist:\n${unexpected.join("\n")}`,
    ).toEqual([]);
  });

  it("the allowlist names files that exist", () => {
    // A stale entry would silently widen the ban's blind spot.
    for (const entry of CURSOR_DRIVEN_ALLOWLIST) {
      expect(
        sourceFiles().some(
          (file) => path.relative(SOURCE_DIR, file).split(path.sep).join("/") === entry,
        ),
        `allowlist entry no longer exists: ${entry}`,
      ).toBe(true);
    }
  });
});
