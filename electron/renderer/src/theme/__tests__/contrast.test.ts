import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  applyAccent,
  contrastRatio,
  hexToRgb,
  readableOn,
  relativeLuminance,
  rgbToHex,
  scaleLightness,
} from "../accent";

// Read the actual file from disk and parse the real token values out of it.
// The whole point of this test is that it fails when someone edits
// tokens.css badly, so nothing here may be a hardcoded copy of the values.
const TOKENS_PATH = path.join(__dirname, "..", "tokens.css");
const TOKENS_CSS = readFileSync(TOKENS_PATH, "utf-8");

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];

/**
 * The file has two mode blocks. A single global regex over the whole file would
 * return the FIRST match for every lookup -- it would read the light value and
 * believe it had tested the dark theme. So the file is split on the dark
 * marker: everything before it is shared + light, everything after is the dark
 * override. A dark lookup falls back to the shared part when the token is not
 * overridden, which is exactly what the cascade does at runtime.
 */
const DARK_MARKER = ':root[data-mode="dark"]';
const SPLIT_AT = TOKENS_CSS.indexOf(DARK_MARKER);
const SHARED_AND_LIGHT = SPLIT_AT === -1 ? TOKENS_CSS : TOKENS_CSS.slice(0, SPLIT_AT);
const DARK_ONLY = SPLIT_AT === -1 ? "" : TOKENS_CSS.slice(SPLIT_AT);

function readToken(name: string, mode: Mode): string {
  const pattern = new RegExp(`${name}:\\s*([^;]+);`);
  const primary = mode === "dark" ? DARK_ONLY : SHARED_AND_LIGHT;
  const match = primary.match(pattern) ?? (mode === "dark" ? SHARED_AND_LIGHT.match(pattern) : null);
  if (!match) {
    throw new Error(`token not found in tokens.css for ${mode} mode: ${name}`);
  }
  return match[1].trim();
}

describe("tokens.css still declares both mode blocks", () => {
  it("declares the dark override block", () => {
    // Without this the split above silently degrades to "one mode", and every
    // dark assertion below would quietly measure the light palette.
    expect(SPLIT_AT).toBeGreaterThan(-1);
  });
});

describe.each(MODES)("ground hierarchy (D9) in %s mode: strictly increasing luminance", (mode) => {
  const voidL = relativeLuminance(readToken("--void", mode));
  const baseL = relativeLuminance(readToken("--base", mode));
  const panelL = relativeLuminance(readToken("--panel", mode));
  const raiseL = relativeLuminance(readToken("--raise", mode));

  it("--void < --base", () => {
    expect(voidL).toBeLessThan(baseL);
  });

  it("--base < --panel", () => {
    expect(baseL).toBeLessThan(panelL);
  });

  it("--panel < --raise", () => {
    expect(panelL).toBeLessThan(raiseL);
  });
});

describe.each(MODES)("text passes WCAG AA on its real ground in %s mode", (mode) => {
  const pairs: Array<[string, string]> = [
    ["--txt", "--panel"],
    ["--txt-lo", "--panel"],
    ["--dim", "--panel"],
    // Chips and fields sit on the raised layer. In DARK mode that is the
    // lightest ground --dim lands on; in LIGHT mode the tightest pair is
    // --dim on --void instead, because the deepest light ground is a mid grey
    // rather than near-black. Keeping both pairs for both modes means neither
    // mode can regress on the other's worst case -- and the light --void pair
    // is what rejects the mock's own #5b6b83 (4.25:1).
    ["--dim", "--raise"],
    ["--dim", "--void"],
    ["--txt-hi", "--panel"],
    // Text-legible siblings of fill/border colours (--ok/--fire/--steel), same
    // precedent as --blood-t: these regressed silently once when light mode
    // shrank this list, so they are pinned here on purpose.
    ["--ok-t", "--base"],
    ["--fire-t", "--base"],
    ["--steel-t", "--panel"],
    ["--blood-t", "--base"],
    ["--on-gold", "--gold"],
  ];

  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg}`, () => {
      const ratio = contrastRatio(readToken(fg, mode), readToken(bg, mode));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("--faint was removed and must not come back", () => {
  // --faint held the same value as --dim after the contrast correction, and
  // two names for one value only invites drift. If a future edit
  // reintroduces --faint, that is exactly the drift we removed -- name it.
  it("--faint does not exist in tokens.css", () => {
    expect(TOKENS_CSS).not.toMatch(/--faint\s*:/);
  });
});

describe("--faint is remapped in mock-bridge.css, same defect as --muted", () => {
  // The mock defines --faint: #93a1b5 in mock-v12.css and never had it
  // corrected -- unlike --muted, which mock-bridge.css already remaps to
  // --dim. AUDIT_huit_pistes_post_v299.md P1: 6 selectors (.st .k among them)
  // rendered under 3:1 on the light ground because of this gap.
  const BRIDGE_PATH = path.join(__dirname, "..", "mock-bridge.css");
  const BRIDGE_CSS = readFileSync(BRIDGE_PATH, "utf-8");

  it("--faint: var(--dim) is present in mock-bridge.css", () => {
    expect(BRIDGE_CSS).toMatch(/--faint:\s*var\(--dim\)/);
  });
});

describe("--blood is documented as NOT text-legible", () => {
  // This is intentional and asserted on purpose: --blood is for fills,
  // borders and the C4 light, where the 4.5:1 text rule does not apply.
  // --blood-t is its text-legible sibling. If someone "fixes" --blood to
  // pass, this test tells them they changed its role.
  it("--blood on --base fails AA", () => {
    const ratio = contrastRatio(readToken("--blood", "light"), readToken("--base", "light"));
    expect(ratio, `--blood on --base measured ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
  });
});

describe("one radius, and it is zero", () => {
  it("--radius parses to 0", () => {
    expect(parseFloat(readToken("--radius", "light"))).toBe(0);
  });

  it("no other radius-ish token exists", () => {
    const radiusTokenNames = [...TOKENS_CSS.matchAll(/(--[a-zA-Z0-9-]*radius[a-zA-Z0-9-]*)\s*:/g)].map(
      (m) => m[1],
    );
    const others = radiusTokenNames.filter((name) => name !== "--radius");
    expect(others).toEqual([]);
  });
});

describe("accent derivation holds for every preset", () => {
  for (const preset of ACCENT_PRESETS) {
    describe(preset.name, () => {
      const root = document.createElement("div");
      applyAccent(preset.hex, root);

      const gold = root.style.getPropertyValue("--gold").trim();
      const goldHi = root.style.getPropertyValue("--gold-hi").trim();
      const goldD = root.style.getPropertyValue("--gold-d").trim();
      const onGold = root.style.getPropertyValue("--on-gold").trim();

      it("--gold equals the preset hex, normalised", () => {
        expect(gold).toBe(rgbToHex(hexToRgb(preset.hex)));
      });

      it("--gold-hi has strictly greater luminance than --gold", () => {
        expect(relativeLuminance(goldHi)).toBeGreaterThan(relativeLuminance(gold));
      });

      it("--gold-d has strictly lower luminance than --gold", () => {
        expect(relativeLuminance(goldD)).toBeLessThan(relativeLuminance(gold));
      });

      it("--on-gold reads at AA on --gold", () => {
        const ratio = contrastRatio(onGold, gold);
        expect(ratio, `--on-gold on --gold measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    });
  }
});

describe("colour maths sanity", () => {
  it("hexToRgb throws on garbage input", () => {
    expect(() => hexToRgb("nope")).toThrow();
    expect(() => hexToRgb("#12")).toThrow();
    expect(() => hexToRgb("#1234567")).toThrow();
  });

  it("hexToRgb expands #rgb the same as the equivalent #rrggbb", () => {
    expect(hexToRgb("#abc")).toEqual(hexToRgb("#aabbcc"));
  });

  it("rgbToHex clamps out-of-range channels", () => {
    expect(rgbToHex({ r: 300, g: -5, b: 0 })).toBe("#ff0000");
  });

  it("contrastRatio is symmetric", () => {
    const a = "#123456";
    const b = "#fedcba";
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });

  it("contrastRatio(black, white) is 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("scaleLightness on pure grey stays grey", () => {
    const result = hexToRgb(scaleLightness("#808080", 1.2));
    expect(result.r).toBe(result.g);
    expect(result.g).toBe(result.b);
  });

  it("readableOn picks a contrast-winning label", () => {
    // Sanity check that the helper used inside applyAccent is exported and
    // behaves the way applyAccent relies on: it should return one of the two
    // documented candidates.
    const pick = readableOn("#0b0e12");
    expect(["#0B0E12", "#F0F4F8"].map((s) => s.toLowerCase())).toContain(pick.toLowerCase());
  });
});
