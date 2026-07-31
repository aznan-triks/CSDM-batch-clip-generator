/**
 * The wheel belongs to the pane that actually scrolls.
 *
 * WHAT WENT WRONG: `motion/scroll.ts` installed Lenis on the WINDOW. That was
 * right when it landed (v214) -- the renderer was still a single long demo
 * page and the window was the thing that scrolled. The shell arrived after it
 * and turned the window into a fixed 100vh frame with the scrolling inside:
 * `.scrollwrap` for the tab, `.console .body` for the log. From that moment
 * Lenis had nothing to move, and because a smooth-scroll library must call
 * `preventDefault()` on every wheel notch to take it over, the notch stopped
 * reaching the panes. The wheel did nothing, anywhere, in either pane.
 *
 * Measured in the window before the fix: a wheel event dispatched on
 * `.scrollwrap` came back `defaultPrevented === true`, while the same event
 * that did not bubble to the window came back `false` -- and `.scrollwrap`
 * scrolled perfectly when moved from JavaScript. The element was never the
 * problem; the listener above it was.
 *
 * Nothing failed loudly, no test went red, and the app looked right in a
 * screenshot: this is exactly the class of defect only a guard on the
 * mechanism can catch.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");

/** Every .ts/.tsx under renderer/src, tests excluded. */
function sourceFiles(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = sourceFiles().map((file) => ({
  name: path.relative(SRC, file).replace(/\\/g, "/"),
  text: readFileSync(file, "utf8"),
}));

describe("nothing takes the wheel away from the panes", () => {
  it("found sources to scan", () => {
    // Without this the two assertions below would pass over an empty list --
    // a guard that checks nothing is worse than no guard.
    expect(FILES.length).toBeGreaterThan(20);
  });

  it("installs no smooth-scroll library over the shell", () => {
    // A page-level scroll hijacker and a fixed 100vh frame cannot coexist:
    // the library owns the wheel and the frame owns the scrolling.
    const offenders = FILES.filter(({ text }) => /\bfrom "(lenis|locomotive|smooth)/i.test(text));
    expect(
      offenders.map((f) => f.name),
      "a smooth-scroll library is back on the window",
    ).toEqual([]);
  });

  it("adds no wheel handler on the window or the document", () => {
    const offenders = FILES.filter(({ text }) =>
      /(window|document)\s*\.\s*addEventListener\(\s*["'](wheel|mousewheel)["']/.test(text),
    );
    expect(
      offenders.map((f) => f.name),
      "a wheel listener above the panes will swallow the notch before it arrives",
    ).toEqual([]);
  });
});

describe("the panes are the scrollers", () => {
  const MOCK = readFileSync(path.join(SRC, "theme", "mock-v12.css"), "utf8");

  it("the approved mock scrolls inside .scrollwrap, and its body does not scroll at all", () => {
    // This is the design's own answer to where scrolling happens, and it is
    // why the window has nothing to smooth: `body { height: 100vh; overflow:
    // hidden }` and `.scrollwrap { overflow-y: auto }`.
    expect(MOCK).toMatch(/\.scrollwrap\{[^}]*overflow-y:\s*auto/);
    expect(MOCK).toMatch(/body\{[^}]*overflow:\s*hidden/);
  });
});
