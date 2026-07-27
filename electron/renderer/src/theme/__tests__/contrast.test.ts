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

function readToken(name: string): string {
  const match = TOKENS_CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) {
    throw new Error(`token not found in tokens.css: ${name}`);
  }
  return match[1].trim();
}

describe("ground hierarchy (D9): strictly increasing luminance", () => {
  const voidL = relativeLuminance(readToken("--void"));
  const baseL = relativeLuminance(readToken("--base"));
  const panelL = relativeLuminance(readToken("--panel"));
  const raiseL = relativeLuminance(readToken("--raise"));

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

describe("text passes WCAG AA on the ground it actually sits on", () => {
  const pairs: Array<[string, string]> = [
    ["--txt", "--panel"],
    ["--txt-lo", "--panel"],
    ["--dim", "--panel"],
    // Chips and fields sit on the raised layer, and it is the LIGHTEST
    // ground --dim lands on -- this is the tightest text pair in the whole
    // theme. It is the one that caught the original --dim regression (it
    // measured 4.14:1 against a --dim calibrated on --panel), so do not
    // remove it as "redundant" with the --panel pair above: the --panel
    // pair alone would not have caught that bug.
    ["--dim", "--raise"],
    ["--dim", "--void"],
    ["--blood-t", "--base"],
    ["--ok", "--base"],
    ["--steel", "--panel"],
    ["--on-gold", "--gold"],
  ];

  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg} >= 4.5:1`, () => {
      const ratio = contrastRatio(readToken(fg), readToken(bg));
      expect(ratio, `${fg} on ${bg} measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
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

describe("--blood is documented as NOT text-legible", () => {
  // This is intentional and asserted on purpose: --blood is for fills,
  // borders and the C4 light, where the 4.5:1 text rule does not apply.
  // --blood-t is its text-legible sibling. If someone "fixes" --blood to
  // pass, this test tells them they changed its role.
  it("--blood on --base fails AA", () => {
    const ratio = contrastRatio(readToken("--blood"), readToken("--base"));
    expect(ratio, `--blood on --base measured ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
  });
});

describe("one radius, and it is zero", () => {
  it("--radius parses to 0", () => {
    expect(parseFloat(readToken("--radius"))).toBe(0);
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
