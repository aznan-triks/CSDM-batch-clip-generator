/**
 * The default accent must not drift from the V12 mock's electric blue (#2563EB).
 */
import { describe, expect, it } from "vitest";

import { ACCENT_PRESETS, DEFAULT_ACCENT } from "../accent";

describe("the default accent matches the V12 mock", () => {
  it("is the mock's electric blue --accent (#2563EB)", () => {
    // mockup-v12-hologlass.html: `--accent: #2563EB`. tokens.css already ships
    // `--gold: #2563eb` as the token default; the applied default must agree,
    // not override it with gold.
    expect(DEFAULT_ACCENT.toUpperCase()).toBe("#2563EB");
  });

  it("is the first swatch, so the picker shows it selected out of the box", () => {
    expect(ACCENT_PRESETS[0].hex.toUpperCase()).toBe("#2563EB");
  });
});
