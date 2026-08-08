/**
 * Per-tab card placement on a block grid (Section A redesign: every card
 * occupies a contiguous rectangle of cells, with explicit column/row start
 * and span -- never reordered by auto-flow, never bumped by neighbours).
 *
 * Reconciliation: a stored id that is no longer declared is dropped; a
 * declared id missing from the stored map is auto-placed at the first free
 * cell. A card can never disappear because of stale state.
 *
 * The old `order`/`wide` schema (3.2.0) is migrated on read: cards with no
 * explicit slot get colSpan=2 if they were wide, or colSpan=1 otherwise,
 * and are appended row by row in their old order.
 */
import { useRef } from "react";

import { useSetting } from "../settings/store";

/** One block = `ui_card_block_size` px (config key). */
const DEFAULT_BLOCK = 96;

/**
 * How many blocks a NEW card spans by default. Chosen so a card reads at a
 * comfortable width for the smallest common content (a handful of controls):
 * 3 × 96px + gaps ≈ 300px. The user then resizes from the corner.
 */
const DEFAULT_COL_SPAN = 3;
const DEFAULT_ROW_SPAN = 1;

export interface CardSlot {
  col: number;     // 1-indexed grid column
  row: number;     // 1-indexed grid row
  colSpan: number; // ≥ 1, always fits in the current column count
  rowSpan: number; // ≥ 1, clamped below auto-fit minimum
}

interface TabLayout {
  /**
   * Schema version. Bump when the meaning of stored slots changes so stale
   * cards (e.g. written by an older default-span bug) are dropped instead of
   * overriding new defaults.
   */
  v?: number;
  /** Per-card explicit slot. Absent = auto-place. */
  cards?: Record<string, CardSlot>;
  /** Ids currently folded. */
  collapsed?: string[];
}

type UiSections = Record<string, TabLayout>;

/** Current layout schema. Bump on any breaking change to `CardSlot`. */
const LAYOUT_VERSION = 2;

export interface SectionLayout {
  /** Resolved slot -- persisted value or a freshly auto-placed one. */
  slot(id: string): CardSlot;
  isCollapsed(id: string): boolean;
  toggleCollapsed(id: string): void;
  /** Move a card to an explicit cell. */
  place(id: string, col: number, row: number): void;
  /** Change a card's span. */
  resize(id: string, colSpan: number, rowSpan: number): void;
  /** The block size in px, read from the `--block` CSS custom property. */
  blockSize(): number;
}

/**
 * Build an occupancy grid from explicit slots, returning the first free cell
 * for a card of the given span dimensions.  Scans row-by-row, left-to-right.
 */
export function autoPlace(
  existing: Record<string, CardSlot>,
  colSpan: number,
  rowSpan: number,
  cols: number,
): CardSlot {
  // Build a bitmap of occupied cells.
  const grid = new Map<string, boolean>();
  for (const slot of Object.values(existing)) {
    for (let r = slot.row; r < slot.row + slot.rowSpan; r++) {
      for (let c = slot.col; c < slot.col + slot.colSpan; c++) {
        grid.set(`${c},${r}`, true);
      }
    }
  }
  // Scan a generous row budget (100): the grid has no fixed height, and
  // this only bounds the search when the first free cell sits absurdly far
  // down -- beyond it the fallback stacks at the bottom anyway.
  for (let row = 1; row <= 100; row++) {
    for (let col = 1; col + colSpan - 1 <= cols; col++) {
      let fits = true;
      for (let dr = 0; dr < rowSpan && fits; dr++) {
        for (let dc = 0; dc < colSpan && fits; dc++) {
          if (grid.has(`${col + dc},${row + dr}`)) fits = false;
        }
      }
      if (fits) return { col, row, colSpan, rowSpan };
    }
  }
  // Fallback: stack at the bottom in the first column.
  const maxRow = Object.values(existing).reduce(
    (m, s) => Math.max(m, s.row + s.rowSpan - 1),
    0,
  );
  return { col: 1, row: maxRow + 1, colSpan: colSpan === 0 ? 1 : colSpan, rowSpan: rowSpan || 1 };
}

/** Migrate a pre-3.2.3 layout to the card-slot format, once. */
function migrateLayout(layout: TabLayout | undefined, _defaultOrder: readonly string[]): TabLayout {
  // Already current, or a card map exists but only the version is stale: keep
  // the user's placement and just stamp the new version (an all-or-nothing
  // reset would wipe every card position on the next schema bump).
  if (layout?.cards) return layout.v === LAYOUT_VERSION ? layout : { ...layout, v: LAYOUT_VERSION };
  const cards: Record<string, CardSlot> = {};
  const oldLayout = layout as { order?: string[]; wide?: Record<string, boolean>; collapsed?: string[] } | undefined;
  const order = oldLayout?.order ?? [];
  const wide = oldLayout?.wide ?? {};
  const collapsed = oldLayout?.collapsed ?? [];
  for (const id of order) {
    cards[id] = { col: 1, row: 1, colSpan: wide[id] ? 2 : 1, rowSpan: 1 };
  }
  // Recompute positions row-by-row in declared order.
  const cols = 3; // generous default; autoPlace ignores out-of-bounds
  for (const id of order) {
    const slot = autoPlace(
      Object.fromEntries(
        order.slice(0, order.indexOf(id)).map((i) => [i, cards[i]]),
      ),
      cards[id].colSpan,
      cards[id].rowSpan,
      cols,
    );
    cards[id] = slot;
  }
  return { v: LAYOUT_VERSION, cards, collapsed };
}

export function useSectionLayout(
  tabId: string,
  defaultOrder: readonly string[],
  /** Cards declared `.wide` by their tab; their auto-place default spans every column. */
  wideIds?: ReadonlySet<string>,
): SectionLayout {
  const [stored, setStored] = useSetting<UiSections>("ui_sections");
  const raw = stored?.[tabId];
  const layout = migrateLayout(raw ? { ...raw } : undefined, defaultOrder);

  /**
   * Auto-placed slots that were never explicitly stored. Kept in a ref so
   * successive `slot()` calls within the same session see each other's
   * placements -- without this, every call started from an empty map and
   * autoPlace put every card at (1,1).
   */
  const autoPlaced = useRef<Record<string, CardSlot>>({});
  /** The column count used for the last auto-placement (0 = never). */
  const lastColsRef = useRef(0);

  /** Explicit slots + session auto-placed slots, in one occupancy map. */
  function knownSlots(): Record<string, CardSlot> {
    return { ...(layout.cards ?? {}), ...autoPlaced.current };
  }

  function persist(next: Record<string, CardSlot>, nextCollapsed: string[]): void {
    autoPlaced.current = {};
    setStored({
      ...(stored ?? {}),
      [tabId]: { v: LAYOUT_VERSION, cards: next, collapsed: nextCollapsed },
    });
  }

  // Look up the block size from the CSS custom property on <html>.
  function readBlockSize(): number {
    if (typeof document === "undefined") return DEFAULT_BLOCK;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--block");
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BLOCK;
  }

  const wrapper = {
    slot(id: string): CardSlot {
      const explicit = layout.cards?.[id];
      if (explicit) return explicit;
      const cols = (typeof document !== "undefined" && document.querySelector('[role="tabpanel"] .bento'))
        ? (() => {
            const style = getComputedStyle(document.querySelector('[role="tabpanel"] .bento')!);
            return style.gridTemplateColumns.split(" ").length;
          })()
        : 2;
      // If the grid's real column count differs from the count used for the
      // last auto-placement, the cached layout is stale (e.g. the very first
      // render ran before the bento existed and saw 2 columns). Drop it and
      // re-place on the real grid.
      if (lastColsRef.current !== 0 && lastColsRef.current !== cols) {
        autoPlaced.current = {};
      }
      lastColsRef.current = cols;
      const cached = autoPlaced.current[id];
      if (cached) return cached;
      const span = wideIds?.has(id) ? cols : DEFAULT_COL_SPAN;
      const placed = autoPlace(
        knownSlots(),
        span,
        DEFAULT_ROW_SPAN,
        cols || 2,
      );
      autoPlaced.current[id] = placed;
      return placed;
    },

    isCollapsed(id: string): boolean {
      return (layout.collapsed ?? []).includes(id);
    },

    toggleCollapsed(id: string): void {
      const set = new Set(layout.collapsed ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      persist(knownSlots(), [...set]);
    },

    place(id: string, col: number, row: number): void {
      const cards = knownSlots();
      const existing = cards[id] ?? { col: 1, row: 1, colSpan: DEFAULT_COL_SPAN, rowSpan: DEFAULT_ROW_SPAN };
      cards[id] = { ...existing, col, row };
      persist(cards, layout.collapsed ?? []);
    },

    resize(id: string, colSpan: number, rowSpan: number): void {
      const cards = knownSlots();
      const existing = cards[id] ?? { col: 1, row: 1, colSpan: DEFAULT_COL_SPAN, rowSpan: DEFAULT_ROW_SPAN };
      cards[id] = { ...existing, colSpan: Math.max(1, colSpan), rowSpan: Math.max(1, rowSpan) };
      persist(cards, layout.collapsed ?? []);
    },

    blockSize(): number {
      return readBlockSize();
    },
  };

  return wrapper;
}
