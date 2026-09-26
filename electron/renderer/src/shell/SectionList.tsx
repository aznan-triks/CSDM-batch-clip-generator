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

import { layoutChildren, naturalRows } from "./cardFit";
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
const FALLBACK_BLOCK = 48;
const FALLBACK_GAP = 10;
const FALLBACK_ROW = 24;

/**
 * Oscillation guard: a card whose fitted height changes more often than this
 * within FIT_BURST_WINDOW_MS stops being fitted for the rest of the session
 * and keeps its last height. Content that sizes itself off the card's own
 * height (a `height: 100%` body child, say) would otherwise feed the
 * measurement back into itself forever. Not a config value -- no user tunes
 * it; a real style switch or window resize settles in one or two changes.
 */
const FIT_BURST_LIMIT = 12;
const FIT_BURST_WINDOW_MS = 1000;

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

  // Content-fitted heights (fix/cards-fit-style). A card the user never
  // resized by hand (`manual` unset) is exactly as tall as its content, in
  // whatever card style and at whatever pane width is current; the stored
  // `h` is only its first-paint height. A hand-resized card keeps its size.
  //
  // `fitted` is render state; `fitRef` is the latest measurement, which runs
  // ahead of it while the user drags or resizes -- the grid must not move
  // under the pointer, so nothing is applied until the gesture ends.
  const [fitted, setFitted] = useState<Record<string, number>>({});
  const fitRef = useRef<Record<string, number>>({});
  const busyRef = useRef(false);

  useEffect(() => {
    const pane = containerRef.current;
    if (!pane || typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return;

    const frozen = new Set<string>();
    const bursts = new Map<string, number[]>();

    // Measured in the ResizeObserver callback itself: layout is clean there,
    // so the reads cost no extra layout pass. Re-measuring a card whose own
    // height just changed yields the same rows (its content does not depend
    // on its box), so the loop ends after one round -- the burst guard above
    // is only for content that breaks that assumption.
    const resizes = new ResizeObserver((entries) => {
      const cards = new Map<string, HTMLElement>();
      for (const entry of entries) {
        const node = entry.target?.closest("[data-card-id]");
        const id = node?.getAttribute("data-card-id");
        if (id && node instanceof HTMLElement) cards.set(id, node);
      }
      let next: Record<string, number> | null = null;
      const now = performance.now();
      for (const [id, node] of cards) {
        if (frozen.has(id)) continue;
        const rows = naturalRows(node, rowHeight, gap);
        if (rows === null || rows === (next ?? fitRef.current)[id]) continue;
        const recent = (bursts.get(id) ?? []).filter((t) => now - t < FIT_BURST_WINDOW_MS);
        recent.push(now);
        bursts.set(id, recent);
        if (recent.length > FIT_BURST_LIMIT) {
          frozen.add(id);
          continue;
        }
        next = { ...(next ?? fitRef.current), [id]: rows };
      }
      if (!next) return;
      fitRef.current = next;
      if (!busyRef.current) setFitted(next);
    });

    // What to watch: each card's body and its direct children. A card style
    // switch or a bridge reply (KillFiltersSection's `describe_filters`)
    // REPLACES those children, and the grid itself unmounts while its tab is
    // hidden (width 0), so the set is re-read on every structural change.
    // `observe` on an already watched element is a no-op; a newly watched one
    // gets an initial callback, which is what measures a fresh card.
    const watched = new Set<Element>();
    const rewire = () => {
      for (const element of watched) {
        if (!element.isConnected) {
          resizes.unobserve(element);
          watched.delete(element);
        }
      }
      for (const scroller of pane.querySelectorAll("[data-card-id] .sb-scroll")) {
        for (const element of [scroller, ...layoutChildren(scroller)]) {
          if (watched.has(element)) continue;
          watched.add(element);
          resizes.observe(element);
        }
      }
    };
    const mutations = new MutationObserver(rewire);
    mutations.observe(pane, { childList: true, subtree: true });
    rewire();

    return () => {
      mutations.disconnect();
      resizes.disconnect();
    };
  }, [rowHeight, gap]);

  const rglLayout: Layout = declaredIds.map((id) => {
    // `slots()` covers every declared card; the fallback only guards a caller
    // (a test stub) that declares more cards than it stores.
    const { x, y, w, h, manual } = slots[id] ?? ({} as GridSlot);
    const collapsed = layout.isCollapsed(id);
    return {
      i: id,
      x,
      y,
      w,
      h: collapsed || manual ? h : (fitted[id] ?? h),
      // A collapsed card has no height to give: leaving the corner live would
      // let the user store a height that expanding immediately overwrites.
      isResizable: !collapsed,
    };
  });

  // Persisted only from `onDragStop`/`onResizeStop`, never from
  // `onLayoutChange`: the library also fires `onLayoutChange` whenever `cols`
  // changes (a window resize re-measures this pane -- readPx/`cols` above),
  // recomputing every item's rectangle to fit the new column count. Wiring
  // save() to that meant a transient narrow window permanently overwrote a
  // card's rectangle with the clamped one, and widening back could never
  // recover it -- nothing remembered the original (unlike height's `hPrev`).
  // Drag/resize stop only fire from an actual user gesture, so this is the
  // one place a rectangle change is truly the user's to keep.
  function toSlots(next: Layout): Record<string, GridSlot> {
    const cards: Record<string, GridSlot> = {};
    for (const item of next) {
      cards[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
    }
    return cards;
  }

  function startGesture(): void {
    busyRef.current = true;
  }

  // The gesture is over: apply whatever was measured meanwhile.
  function endGesture(): void {
    busyRef.current = false;
    setFitted(fitRef.current);
  }

  function onDragStop(next: Layout): void {
    layout.save(toSlots(next));
    endGesture();
  }

  // A resize that changed the height makes that height the user's: the card
  // stops fitting its content and keeps it. Widening alone does not -- the
  // card still grows or shrinks to its content at the new width.
  function onResizeStop(next: Layout, oldItem: Layout[number] | null, newItem: Layout[number] | null): void {
    const cards = toSlots(next);
    if (newItem && oldItem && newItem.h !== oldItem.h && cards[newItem.i]) {
      cards[newItem.i].manual = true;
    }
    layout.save(cards);
    endGesture();
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
          onDragStart={startGesture}
          onResizeStart={startGesture}
          onDragStop={onDragStop}
          onResizeStop={onResizeStop}
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
                    title="Drag to move this card within the grid"
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
