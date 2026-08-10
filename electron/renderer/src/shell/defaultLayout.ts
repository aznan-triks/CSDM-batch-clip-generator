/**
 * The reference layout: where a tab's cards sit before the user moves them,
 * and where "reset" puts them back.
 *
 * It is DERIVED, not tabulated. A table of x/y/w/h per card would have to be
 * maintained every time a card is added or renamed, and would silently rot
 * (the same failure mode as every hand-copied list in this codebase). The
 * rule instead reads what a tab already declares: cards come in reading
 * order, a `wide` card takes the full width, everything else takes
 * `DEFAULT_CARD_COLS`, and rows wrap when the next card no longer fits.
 */
import type { GridSlot } from "./sectionLayout";

/** Columns a normal (non-wide) card spans by default. */
export const DEFAULT_CARD_COLS = 3;

/** Fine rows a card spans by default -- 24 rows of 24px reads as a full card. */
export const DEFAULT_CARD_ROWS = 24;

export interface DefaultLayoutInput {
  id: string;
  /** Declared full-width by the tab (the mock's `wide` class). */
  wide: boolean;
  /** An explicit placement that overrides the derived one. Nothing uses it yet. */
  defaultSlot?: Partial<GridSlot>;
  /**
   * Height in fine rows, measured from the card's own content. Absent means
   * "not measured yet" and falls back to DEFAULT_CARD_ROWS -- a flat 24 rows
   * (576px) made every card the same height as the tallest one, which is why
   * a fresh window scrolled on its first paint.
   */
  rows?: number;
}

/**
 * Place every section, left to right then down.
 *
 * `cols` is the measured column count, so the reference layout is the one
 * that fits the window the user actually has -- resetting in a narrow window
 * does not produce a layout only a wide window could show.
 */
export function defaultSlots(
  sections: readonly DefaultLayoutInput[],
  cols: number,
): Record<string, GridSlot> {
  const columns = Math.max(1, Math.floor(cols));
  const slots: Record<string, GridSlot> = {};
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const section of sections) {
    const width = Math.max(1, Math.min(section.wide ? columns : DEFAULT_CARD_COLS, columns));
    const height = Math.max(1, Math.round(section.rows ?? DEFAULT_CARD_ROWS));

    if (cursorX + width > columns) {
      // No room left on this row: drop below the tallest card of the row.
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }

    const derived: GridSlot = { x: cursorX, y: cursorY, w: width, h: height };
    const override = section.defaultSlot;
    const slot: GridSlot = override
      ? {
          x: override.x ?? derived.x,
          y: override.y ?? derived.y,
          w: override.w ?? derived.w,
          h: override.h ?? derived.h,
        }
      : derived;

    // Clamp even an override: a card outside the grid is unreachable.
    slot.w = Math.max(1, Math.min(slot.w, columns));
    slot.x = Math.max(0, Math.min(slot.x, columns - slot.w));
    slots[section.id] = slot;

    if (!override) {
      cursorX += width;
      rowHeight = Math.max(rowHeight, height);
      if (cursorX >= columns) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }
    }
  }

  return slots;
}
