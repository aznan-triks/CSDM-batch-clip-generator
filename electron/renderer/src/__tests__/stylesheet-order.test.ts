/**
 * The shipped cascade order, guarded.
 *
 * WHY THIS EXISTS: main.tsx says the approved mock is the BASE sheet and the
 * component stylesheets refine it. That sentence was true of the comment and
 * false of the bundle. ES modules are evaluated in source order, so an
 * `import App` sitting above the theme imports pulls every component
 * stylesheet in FIRST -- and the mock, arriving last, overruled all of them.
 * Measured in the built CSS before the fix: Tab.css at byte 37125,
 * mock-v12.css at 47897.
 *
 * The inversion is invisible: no test fails, nothing throws, the window merely
 * stops obeying its own component sheets. Hence a guard on the source order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `__dirname`, not `new URL(path, import.meta.url)`: the latter throws "The
// URL must be of scheme file" under this Vitest setup (same note as
// theme/__tests__/mock-v12.test.ts).
const MAIN = readFileSync(path.join(__dirname, "..", "main.tsx"), "utf8");

/** Character offset of an import statement, or -1. */
function importAt(specifier: string): number {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return MAIN.search(new RegExp(`^import[^\\n]*["']${escaped}["']`, "m"));
}

describe("main.tsx stylesheet order", () => {
  it("loads the mock, then the bridge, then the tokens", () => {
    const mock = importAt("./theme/mock-v12.css");
    const bridge = importAt("./theme/mock-bridge.css");
    const tokens = importAt("./theme/tokens.css");
    expect(mock, "the approved mock is not imported").toBeGreaterThan(-1);
    expect(bridge, "the bridge must come after the mock it corrects").toBeGreaterThan(mock);
    expect(tokens, "the app's own tokens must win over the mock's").toBeGreaterThan(bridge);
  });

  it("loads every theme sheet before App, whose imports drag in the components", () => {
    const app = importAt("./App");
    expect(app, "App is not imported").toBeGreaterThan(-1);
    for (const sheet of ["./theme/mock-v12.css", "./theme/mock-bridge.css", "./theme/tokens.css"]) {
      expect(
        importAt(sheet),
        `${sheet} is imported after App, so every component stylesheet loads ` +
          "before it and the mock silently overrules the whole window",
      ).toBeLessThan(app);
    }
  });
});
