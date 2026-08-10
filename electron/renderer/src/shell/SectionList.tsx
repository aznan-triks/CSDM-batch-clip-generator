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

import { useSectionLayout, type GridSlot } from "./sectionLayout";
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
  // One column is exactly one block wide, as before; how many fit is what the
  // pane's width decides.
  const cols = Math.max(1, Math.floor((width + gap) / (block + gap)));

  const declaredIds = sections.map((s) => s.id);
  const wideIds = new Set(
    sections
      .filter((s) => (s.element.props.className ?? "").split(/\s+/).includes("wide"))
      .map((s) => s.id),
  );
  const layout = useSectionLayout(tabId, declaredIds, cols, wideIds);
  const slots = layout.slots();

  const rglLayout: Layout = declaredIds.map((id) => ({ i: id, ...slots[id] }));

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
            <div key={spec.id} className={spec.element.props.className ?? undefined}>
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
