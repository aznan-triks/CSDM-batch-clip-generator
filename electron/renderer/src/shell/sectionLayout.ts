/**
 * Per-tab card placement, persisted in the `ui_sections` config key.
 *
 * This module OWNS the stored shape and its migration -- nothing else.  The
 * placement itself (drag, resize, pushing neighbours out of the way) belongs
 * to react-grid-layout: five hand-rolled attempts at that arithmetic each
 * shipped a different drift bug (commits 45b459a..a8a6bef).
 *
 * Units: `x`/`w` are grid columns, one column = `ui_card_block_size` px.
 * `y`/`h` are fine rows, one row = `ui_card_row_height` px, so a card's
 * height is free rather than quantised to whole blocks.
 */
import { useSetting } from "../settings/store";

/** A card's rectangle, in react-grid-layout units (0-indexed). */
export interface GridSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TabLayout {
  v?: number;
  cards?: Record<string, GridSlot>;
  collapsed?: string[];
}

type UiSections = Record<string, TabLayout>;

/** Current stored schema. Bump on any breaking change to `GridSlot`. */
export const LAYOUT_VERSION = 3;

/**
 * Fine rows per block: the v2 schema sized rows in whole blocks (96px), v3
 * sizes them in quarter-blocks (24px). Also the scale factor of the v2 -> v3
 * migration.
 */
export const ROWS_PER_BLOCK = 4;

/** Default span of a card with no stored slot: readable for a few controls. */
const DEFAULT_W = 3;
const DEFAULT_H = 6 * ROWS_PER_BLOCK;

export interface SectionLayout {
  /** Every declared card's rectangle, migrated and reconciled. */
  slots(): Record<string, GridSlot>;
  isCollapsed(id: string): boolean;
  toggleCollapsed(id: string): void;
  /** Persist a full set of rectangles (what react-grid-layout just produced). */
  save(next: Record<string, GridSlot>): void;
}

function isSlot(value: unknown): value is GridSlot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof s[k] === "number" && Number.isFinite(s[k]));
}

/** The pre-v3 shape: 1-indexed cells, spans counted in whole blocks. */
function isV2Slot(value: unknown): value is { col: number; row: number; colSpan: number; rowSpan: number } {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return ["col", "row", "colSpan", "rowSpan"].every((k) => typeof s[k] === "number");
}

/**
 * Reconcile the stored value with the cards a tab actually declares.
 *
 * Never resets: a v2 layout is converted in place, and a schema bump keeps
 * every rectangle it can read. A declared card with no readable slot is
 * appended at the bottom (`y: Infinity` is react-grid-layout's "put it after
 * everything"), which is why this module needs no placement arithmetic of
 * its own.
 */
export function migrateLayout(
  raw: unknown,
  declaredIds: readonly string[],
  cols: number,
  wideIds?: ReadonlySet<string>,
): { cards: Record<string, GridSlot>; collapsed: string[] } {
  const layout = (typeof raw === "object" && raw !== null ? raw : {}) as TabLayout;
  const storedCards = (typeof layout.cards === "object" && layout.cards !== null ? layout.cards : {}) as Record<
    string,
    unknown
  >;
  const collapsed = Array.isArray(layout.collapsed) ? layout.collapsed.filter((id) => typeof id === "string") : [];

  const cards: Record<string, GridSlot> = {};
  for (const id of declaredIds) {
    const stored = storedCards[id];
    let slot: GridSlot | null = null;
    if (isSlot(stored)) {
      slot = { ...stored };
    } else if (isV2Slot(stored)) {
      slot = {
        x: Math.max(0, stored.col - 1),
        y: Math.max(0, (stored.row - 1) * ROWS_PER_BLOCK),
        w: Math.max(1, stored.colSpan),
        h: Math.max(1, stored.rowSpan * ROWS_PER_BLOCK),
      };
    }
    if (!slot) {
      slot = {
        x: 0,
        y: Number.POSITIVE_INFINITY,
        w: wideIds?.has(id) ? cols : DEFAULT_W,
        h: DEFAULT_H,
      };
    }
    // Clamp into the grid: a card wider than the pane would be unreachable.
    slot.w = Math.max(1, Math.min(slot.w, cols));
    slot.x = Math.max(0, Math.min(slot.x, cols - slot.w));
    slot.h = Math.max(1, slot.h);
    cards[id] = slot;
  }
  return { cards, collapsed: collapsed.filter((id) => declaredIds.includes(id)) };
}

export function useSectionLayout(
  tabId: string,
  declaredIds: readonly string[],
  cols: number,
  wideIds?: ReadonlySet<string>,
): SectionLayout {
  const [stored, setStored] = useSetting<UiSections>("ui_sections");
  const { cards, collapsed } = migrateLayout(stored?.[tabId], declaredIds, cols, wideIds);

  function persist(nextCards: Record<string, GridSlot>, nextCollapsed: string[]): void {
    setStored({
      ...(stored ?? {}),
      [tabId]: { v: LAYOUT_VERSION, cards: nextCards, collapsed: nextCollapsed },
    });
  }

  return {
    slots: () => cards,
    isCollapsed: (id) => collapsed.includes(id),
    toggleCollapsed(id) {
      const set = new Set(collapsed);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      persist(cards, [...set]);
    },
    save(next) {
      persist(next, collapsed);
    },
  };
}
