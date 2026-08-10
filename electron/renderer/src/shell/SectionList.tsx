/**
 * Renders one tab's cards on a react-grid-layout grid.
 *
 * This component is an ADAPTER, not a layout engine: it turns the stored
 * slots into the library's `Layout[]`, and writes back whatever the library
 * hands it after a drag or a resize. Every hand-rolled cell computation that
 * used to live here is gone -- five attempts at it each shipped a different
 * drift bug (commits 45b459a..a8a6bef).
 *
 * Width is measured here rather than through the library's `WidthProvider`:
 * that helper observes `window`, so it misses the console/content splitter
 * being dragged, which resizes this pane without resizing the window.
 */
import { cloneElement, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from "react";
// react-grid-layout ships a v2 default export with a reshaped, nested
// gridConfig/dragConfig/resizeConfig props API. `/legacy` is the library's
// own v1-compatible wrapper (flat cols/rowHeight/draggableHandle/... props,
// converted internally) -- installed by Task 1 as `react-grid-layout`, its
// v1-shaped surface is what this adapter is written against.
import GridLayout, { type Layout } from "react-grid-layout/legacy";

import { useSectionLayout, COLLAPSED_ROWS_FALLBACK, type GridSlot } from "./sectionLayout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./SectionList.css";

export type { GridSlot };

export interface SectionSpec {
  id: string;
  element: ReactElement<{
    className?: string;
    style?: CSSProperties;
    open?: boolean;
    onToggle?: () => void;
    dragHandle?: ReactNode;
  }>;
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

/** Read a pixel-valued custom property off <html>, with a spelled-out fallback. */
function readPx(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Fallbacks mirror `mock-bridge.css`'s own declarations, which are themselves
 * fed from `ui_card_block_size` / `ui_card_row_height`. They only apply when
 * there is no document at all (jsdom without a stylesheet).
 */
const FALLBACK_BLOCK = 96;
const FALLBACK_GAP = 10;
const FALLBACK_ROW = 24;

/**
 * How many fine rows a card needs to show all of its content.
 *
 * `.sb-scroll` is the card's scroller (components/Card.tsx): its
 * `scrollHeight` is the content's real height even while the grid clips it,
 * so the card's natural height is its current height plus whatever the
 * scroller is hiding. Rows are the grid's own unit -- one row plus one gap,
 * except the last row, which carries no gap.
 */
function contentRows(node: Element, rowHeight: number, gap: number): number | null {
  const scroller = node.querySelector(".sb-scroll");
  if (!(scroller instanceof HTMLElement) || !(node instanceof HTMLElement)) return null;
  const natural = node.offsetHeight + (scroller.scrollHeight - scroller.clientHeight);
  if (!Number.isFinite(natural) || natural <= 0) return null;
  return Math.max(1, Math.ceil((natural + gap) / (rowHeight + gap)));
}

/**
 * How long a fresh card's content must stop changing size before its
 * measurement is trusted. Some cards fetch their content over the bridge
 * (KillFiltersSection's `describe_filters`, live 2026-08-10): they mount
 * showing "Loading filters..." and balloon once the reply arrives, well
 * after a single point-in-time read would have already measured and locked
 * in the tiny placeholder's height. Not a config value -- nothing about it
 * is meant to be tuned per user, only long enough to outlast a bridge round
 * trip without feeling laggy.
 */
const MEASURE_SETTLE_MS = 200;

export default function SectionList({ tabId, sections }: SectionListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Measure this pane, not the window: the splitter resizes us on its own.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const block = readPx("--block", FALLBACK_BLOCK);
  const gap = readPx("--block-gap", FALLBACK_GAP);
  const rowHeight = readPx("--block-row", FALLBACK_ROW);
  // A collapsed card is exactly this tall. Read from the same place as every
  // other grid measurement so a config change re-tiles without a restart.
  const collapsedRows = Math.max(1, Math.round(readPx("--block-collapsed-rows", COLLAPSED_ROWS_FALLBACK)));
  // One column is exactly one block wide, as before; how many fit is what the
  // pane's width decides.
  const cols = Math.max(1, Math.floor((width + gap) / (block + gap)));

  const declaredIds = sections.map((s) => s.id);
  const wideIds = new Set(
    sections
      .filter((s) => (s.element.props.className ?? "").split(/\s+/).includes("wide"))
      .map((s) => s.id),
  );
  const layout = useSectionLayout(tabId, declaredIds, cols, wideIds, collapsedRows);
  const slots = layout.slots();

  // A card is measured exactly once: on the render where it has no stored
  // rectangle (fresh install, or the Settings "reset cards" button, which
  // clears `ui_sections`). Past that one commit it is no longer fresh, so no
  // height the user chose -- or the user's own manual resize, later -- is
  // ever overwritten (his call, 2026-08-10). `slots`/`layout` are read
  // through a ref inside the effect: the ResizeObserver callbacks below fire
  // on their own schedule, long after the render that registered them, and
  // closing over the render's own `slots`/`layout` would write back stale
  // rectangles for cards other than the one that just changed.
  const liveRef = useRef({ slots, layout });
  liveRef.current = { slots, layout };

  // The set of fresh cards is captured ONCE, the first render where the grid
  // has actually mounted (`width > 0`) -- never read live off
  // `layout.freshIds()` again. `freshIds()` SHRINKS as each card commits,
  // and it fed the effect's own dependency array directly before this: the
  // first (typically instant) commit changed that array, tearing down every
  // OTHER card's still-pending observer along with it. KILL FILTERS (whose
  // content arrives over the bridge, well after the others) was torn down,
  // re-armed against its still-empty "Loading filters..." placeholder by a
  // sibling's commit, and locked in there before its own content ever
  // arrived -- measured live at the real 1100x900 default, unchanged across
  // three different attempts at the timing before this snapshot was taken.
  const [freshSnapshot, setFreshSnapshot] = useState<string[] | null>(null);
  useEffect(() => {
    if (freshSnapshot !== null || width <= 0) return;
    const ids = layout.freshIds();
    if (ids.length > 0) setFreshSnapshot(ids);
    // Runs once per mount (tabId change remounts this component): checked by
    // `freshSnapshot !== null` above, not by a dependency list that would
    // have to include the ever-shrinking `layout.freshIds()` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, freshSnapshot]);

  useEffect(() => {
    if (!freshSnapshot || !containerRef.current) return;

    // Commits within this one measurement pass must never lose each other.
    // Seeding each write from `liveRef.current.slots` raced whenever two
    // cards settled close together: React may not have re-rendered (and
    // refreshed `liveRef`) between them, so the second commit's base
    // excluded the first's just-saved height and silently reverted it
    // (found live: PLAYER's measured 500 reverted to the 806 default the
    // moment KILL FILTERS' later commit landed). `localCards` is one
    // accumulator shared by every commit in THIS pass, mutated in place --
    // JS has no threads, so even callbacks that fire a millisecond apart
    // still touch it one at a time, in order.
    const localCards = { ...slots };
    const stops: Array<() => void> = [];

    for (const id of freshSnapshot) {
      if (liveRef.current.layout.isCollapsed(id)) continue;
      const node = containerRef.current.querySelector(`[data-card-id="${id}"]`);
      const scroller = node?.querySelector(".sb-scroll");
      if (!node || !(scroller instanceof HTMLElement)) continue;

      let settle: ReturnType<typeof setTimeout> | null = null;
      let observer: MutationObserver | null = null;
      let stopped = false;
      const stop = () => {
        stopped = true;
        if (settle) clearTimeout(settle);
        observer?.disconnect();
      };
      const schedule = () => {
        if (stopped) return;
        const rows = contentRows(node, rowHeight, gap);
        if (rows === null) return;
        // A card whose content is still arriving (KillFiltersSection's
        // `describe_filters` reply, say) mutates more than once; each
        // mutation restarts the wait so only the SETTLED height is ever
        // committed.
        if (settle) clearTimeout(settle);
        settle = setTimeout(() => {
          // One commit per card, ever, THEN the observer stops -- a later
          // change to this same content (a filter's sub-panel opening, say)
          // must never fight a height the user has since chosen by hand.
          stop();
          if (liveRef.current.layout.isCollapsed(id) || rows === localCards[id]?.h) return;
          localCards[id] = { ...localCards[id], h: rows };
          liveRef.current.layout.save({ ...localCards });
        }, MEASURE_SETTLE_MS);
      };

      if (typeof MutationObserver !== "undefined") {
        // A ResizeObserver on the scroller's content watches the WRONG
        // event here: KillFiltersSection doesn't resize its placeholder, it
        // REPLACES it -- `<p>Loading filters...</p>` unmounts and a whole
        // new `<div class="kill-filters">` mounts in its place once
        // `describe_filters` answers. A ResizeObserver bound to the old `<p>`
        // node is watching an element that has already left the document;
        // it never fires again (measured live: the scroller's box sat still
        // at 728px while its content grew to 1954px, unnoticed). `.sb-scroll`
        // itself never gets replaced, only its children do, so THAT is the
        // stable node to watch -- for any mutation, not just a resize.
        observer = new MutationObserver(schedule);
        observer.observe(scroller, { childList: true, subtree: true, characterData: true });
      }
      schedule();
      stops.push(stop);
    }

    return () => stops.forEach((stop) => stop());
    // `layout`/`slots` are read live through `liveRef`; the effect itself
    // only needs to (re)start when the frozen fresh-card list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshSnapshot, rowHeight, gap]);

  const rglLayout: Layout = declaredIds.map((id) => ({
    i: id,
    ...slots[id],
    // A collapsed card has no height to give: leaving the corner live would
    // let the user store a height that expanding immediately overwrites.
    isResizable: !layout.isCollapsed(id),
  }));

  function onLayoutChange(next: Layout): void {
    const cards: Record<string, GridSlot> = {};
    for (const item of next) {
      cards[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
    }
    layout.save(cards);
  }

  return (
    <div className="grid-pane" ref={containerRef}>
      {width > 0 && (
        <GridLayout
          className="card-grid"
          layout={rglLayout}
          cols={cols}
          rowHeight={rowHeight}
          width={width}
          margin={[gap, gap]}
          containerPadding={[0, 0]}
          draggableHandle=".drag-handle"
          compactType="vertical"
          preventCollision={false}
          isBounded
          onLayoutChange={onLayoutChange}
          resizeHandles={["se"]}
        >
          {sections.map((spec) => (
            /* A real DOM element as the grid child, not <Card> itself.
               react-resizable appends its handle to the children of what it
               clones: with a component there, `cloneElement` overwrote Card's
               `children` prop and the handle landed inside `.sb-scroll` --
               scrolling away with the content and out of reach of every
               `.react-grid-item > ...` rule (audit 2026-08-10). With a <div>,
               the handle arrives as the card's sibling, on the frame. */
            <div key={spec.id} data-card-id={spec.id} className={spec.element.props.className ?? undefined}>
              {cloneElement(spec.element, {
                open: !layout.isCollapsed(spec.id),
                onToggle: () => layout.toggleCollapsed(spec.id),
                dragHandle: (
                  <span
                    className="drag-handle"
                    aria-label={`drag-${spec.id}`}
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                  >
                    ⠿
                  </span>
                ),
              })}
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
