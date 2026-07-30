import { describe, expect, it } from "vitest";

// NOTE: the pure module lives in "backdropField.ts", not "backdrop.ts" as the
// plan originally named it. "backdrop.ts" next to "Backdrop.tsx" differs only
// in casing, which TypeScript's forceConsistentCasingInFileNames check (and
// bundler resolution on a case-insensitive filesystem) rejects outright --
// this is a real defect in the plan, not a Windows-only quirk. See the task
// report for detail.
import { BACKDROP, borderAlpha, cellIntensity, parseAlpha, valueNoise } from "../backdropField";

describe("the noise field is deterministic", () => {
  it("returns the same value for the same coordinates", () => {
    // A backdrop that shimmers differently on every frame for the same input
    // would be impossible to reason about -- and impossible to test.
    expect(valueNoise(3.25, 7.5)).toBe(valueNoise(3.25, 7.5));
  });

  it("stays inside [0, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is not constant", () => {
    // A hash that collapses to one value would make every plate identical and
    // the whole clustering effect would silently vanish.
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(valueNoise(i * 1.7, i * 2.3));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("plates only light up near the cursor", () => {
  it("is dark far outside the reach window", () => {
    // Chebyshev reach: a plate REACH+2 cells away is outside the square window.
    expect(cellIntensity(0, 0, BACKDROP.reach + 2, 0, 0)).toBe(0);
  });

  it("never exceeds 1 inside the window", () => {
    for (let c = 0; c <= BACKDROP.reach; c++) {
      for (let r = 0; r <= BACKDROP.reach; r++) {
        const a = cellIntensity(c, r, 0, 0, 1234);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lights at least one plate somewhere under the cursor", () => {
    // The threshold could be set so high that nothing ever activates; that
    // would read as "the backdrop is broken" and no other assertion here
    // would catch it.
    let lit = 0;
    for (let c = -BACKDROP.reach; c <= BACKDROP.reach; c++) {
      for (let r = -BACKDROP.reach; r <= BACKDROP.reach; r++) {
        if (cellIntensity(c, r, 0, 0, 5000) > 0) lit++;
      }
    }
    expect(lit).toBeGreaterThan(0);
  });
});

describe("the plate border reacts to the mode-dependent glow tokens", () => {
  it("parseAlpha reads the alpha channel out of an rgba() string", () => {
    expect(parseAlpha("rgba(34, 211, 238, 0.3)")).toBeCloseTo(0.3);
    expect(parseAlpha("rgba(34,211,238,0.46)")).toBeCloseTo(0.46);
  });

  it("borderAlpha is the resting glow at zero intensity", () => {
    expect(borderAlpha(0.16, 0.22, 0)).toBeCloseTo(0.16);
  });

  it("borderAlpha is the active glow at full intensity", () => {
    expect(borderAlpha(0.16, 0.22, 1)).toBeCloseTo(0.22);
  });

  it("borderAlpha differs between light and dark glow pairs at the same intensity", () => {
    // Light mode: rgba(34,211,238,0.16) / rgba(34,211,238,0.22).
    // Dark mode: rgba(34,211,238,0.3) / rgba(34,211,238,0.46).
    const light = borderAlpha(0.16, 0.22, 0.5);
    const dark = borderAlpha(0.3, 0.46, 0.5);
    expect(dark).toBeGreaterThan(light);
  });
});

describe("every backdrop number lives in the table", () => {
  it("declares the geometry and the thresholds", () => {
    // The MOTION rule, applied to the backdrop: a number inside a drawing
    // function is a bug, so the table has to actually carry them.
    for (const key of ["cell", "gap", "reach", "ease", "threshold", "drift"] as const) {
      expect(BACKDROP[key]).toBeDefined();
    }
  });
});
