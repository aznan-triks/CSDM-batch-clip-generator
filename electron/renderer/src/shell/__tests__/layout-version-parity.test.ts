/**
 * The stored layout schema has ONE version number, and Python owns it.
 *
 * `csdm/config.py::_migrate_card_grid_half_step` runs on every `load_config`
 * and stamps each tab with `UI_SECTIONS_VERSION`; `sectionLayout.ts` decides
 * whether a layout still needs migrating by comparing against its own
 * `LAYOUT_VERSION`. Two copies of one number, in two languages, is exactly the
 * kind of pair this codebase reads from the source instead of transcribing
 * (the settings coverage guard does the same with the config keys).
 *
 * If they drift apart, either every layout is migrated forever (Python stamps
 * a version the renderer thinks is old) or none is (the reverse) -- and both
 * fail silently, as a card at half or double width.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COLS_SCALE_V3_TO_V4, LAYOUT_VERSION } from "../sectionLayout";

const CONFIG_PY = readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "csdm", "config.py"),
  "utf-8",
);

/** The integer assigned to a module-level Python constant. */
function pythonInt(name: string): number {
  const match = CONFIG_PY.match(new RegExp(String.raw`^${name}\s*=\s*(\d+)`, "m"));
  if (!match) throw new Error(`${name} not found in csdm/config.py`);
  return Number(match[1]);
}

/** The default value of a `DEFAULT_CONFIG` key. */
function pythonDefault(key: string): number {
  const match = CONFIG_PY.match(new RegExp(String.raw`"${key}":\s*(\d+)`));
  if (!match) throw new Error(`${key} not found in csdm/config.py`);
  return Number(match[1]);
}

/** The column size v3 rectangles were counted in, before the half-step. */
const BLOCK_BEFORE_HALF_STEP = 96;

describe("the renderer's layout schema version mirrors Python's", () => {
  it("LAYOUT_VERSION === UI_SECTIONS_VERSION", () => {
    expect(LAYOUT_VERSION).toBe(pythonInt("UI_SECTIONS_VERSION"));
  });

  it("the v3 -> v4 column scale is the same on both sides", () => {
    expect(COLS_SCALE_V3_TO_V4).toBe(pythonInt("_GRID_HALF_STEP_SCALE"));
  });

  it("the default column is the size that scale assumes", () => {
    // Doubling a v3 rectangle only lands it in the same place if the column
    // really did halve. Pin the two together, or a later tweak to the default
    // column silently starts moving every migrated card.
    expect(pythonDefault("ui_card_block_size") * COLS_SCALE_V3_TO_V4).toBe(BLOCK_BEFORE_HALF_STEP);
  });
});
