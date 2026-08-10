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
import { defaultSlots } from "./defaultLayout";

/** A card's rectangle, in react-grid-layout units (0-indexed). */
export interface GridSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The height this card had before it was collapsed, so expanding gives
   * back the exact rectangle the user chose instead of a default. Absent on
   * an expanded card.
   */
  hPrev?: number;
}

/** Rows a collapsed card occupies when the config key is unreadable. */
export const COLLAPSED_ROWS_FALLBACK = 2;

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

/** Height a re-expanded card falls back to if it never had a remembered one. */
const DEFAULT_H = 6 * ROWS_PER_BLOCK;

export interface SectionLayout {
  /** Every declared card's rectangle, migrated and reconciled. */
  slots(): Record<string, GridSlot>;
  isCollapsed(id: string): boolean;
  toggleCollapsed(id: string): void;
  /** Persist a full set of rectangles (what react-grid-layout just produced). */
  save(next: Record<string, GridSlot>): void;
  /** Cards that had no stored rectangle -- the only ones a measurement may resize. */
  freshIds(): string[];
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
): { cards: Record<string, GridSlot>; collapsed: string[]; fresh: string[] } {
  const layout = (typeof raw === "object" && raw !== null ? raw : {}) as TabLayout;
  const storedCards = (typeof layout.cards === "object" && layout.cards !== null ? layout.cards : {}) as Record<
    string,
    unknown
  >;
  const collapsed = Array.isArray(layout.collapsed) ? layout.collapsed.filter((id) => typeof id === "string") : [];

  const cards: Record<string, GridSlot> = {};
  const fresh: string[] = [];
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
      // A newly declared card lands on its reference placement rather than
      // an anonymous bottom-of-the-pile stack, so a fresh install and a
      // freshly reset tab look the same. It is also the ONLY moment its
      // height may be re-measured: past this write, the rectangle is the
      // user's (SectionList.tsx).
      fresh.push(id);
      const reference = defaultSlots(
        declaredIds.map((cardId) => ({ id: cardId, wide: Boolean(wideIds?.has(cardId)) })),
        cols,
      );
      slot = { ...reference[id] };
    }
    // Clamp into the grid: a card wider than the pane would be unreachable.
    slot.w = Math.max(1, Math.min(slot.w, cols));
    slot.x = Math.max(0, Math.min(slot.x, cols - slot.w));
    slot.h = Math.max(1, slot.h);
    // A stored `hPrev` is carried through, but only if it could actually be
    // restored: a negative or non-finite one would expand the card into an
    // invalid rectangle, so it is dropped and the default takes over.
    const storedPrev = (stored as { hPrev?: unknown })?.hPrev;
    if (typeof storedPrev === "number" && Number.isFinite(storedPrev) && storedPrev >= 1) {
      slot.hPrev = storedPrev;
    } else {
      delete slot.hPrev;
    }
    cards[id] = slot;
  }
  return { cards, collapsed: collapsed.filter((id) => declaredIds.includes(id)), fresh };
}

export function useSectionLayout(
  tabId: string,
  declaredIds: readonly string[],
  cols: number,
  wideIds?: ReadonlySet<string>,
  collapsedRows: number = COLLAPSED_ROWS_FALLBACK,
): SectionLayout {
  const [stored, setStored] = useSetting<UiSections>("ui_sections");
  const { cards, collapsed, fresh } = migrateLayout(stored?.[tabId], declaredIds, cols, wideIds);

  function persist(nextCards: Record<string, GridSlot>, nextCollapsed: string[]): void {
    // The functional form, not `{...(stored ?? {}), [tabId]: ...}`: every
    // tab's SectionList stays mounted at once (AppShell.tsx) and each one
    // calls this independently, so `stored` here can already be behind
    // another tab's write that landed a moment ago. Merging against
    // `previous` (supplied fresh by the store at write time, not this
    // render's closure) is what keeps a fast-settling tab from erasing a
    // slower one's just-saved rectangle.
    setStored((previous) => ({
      ...(previous ?? {}),
      [tabId]: { v: LAYOUT_VERSION, cards: nextCards, collapsed: nextCollapsed },
    }));
  }

  return {
    slots: () => cards,
    freshIds: () => fresh,
    isCollapsed: (id) => collapsed.includes(id),
    toggleCollapsed(id) {
      const set = new Set(collapsed);
      const slot = cards[id];
      const nextCards = { ...cards };
      if (set.has(id)) {
        // Expanding: give back the exact height the card had, never a default.
        set.delete(id);
        nextCards[id] = { ...slot, h: slot.hPrev ?? DEFAULT_H };
        delete nextCards[id].hPrev;
      } else {
        // Collapsing is a LAYOUT change, not a paint: the grid must be told
        // the card shrank, or it keeps serving the stored height and leaves
        // an empty rectangle under the header (measured 377px, 2026-08-10).
        set.add(id);
        nextCards[id] = { ...slot, h: collapsedRows, hPrev: slot.h };
      }
      persist(nextCards, [...set]);
    },
    save(next) {
      // Never let a write-back erase the remembered height: react-grid-layout
      // knows nothing about `hPrev` and hands back rectangles without it.
      const merged: Record<string, GridSlot> = {};
      for (const [id, slot] of Object.entries(next)) {
        const prev = cards[id]?.hPrev;
        merged[id] = prev === undefined ? slot : { ...slot, hPrev: prev };
      }
      persist(merged, collapsed);
    },
  };
}
