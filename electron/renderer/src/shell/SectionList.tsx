/**
 * Renders one tab's cards in persisted order, with drag-to-reorder.
 *
 * No wrapper element around a Card: `.bento` is `display:grid` and `.wide`
 * spans it via `grid-column:1/-1` on the .sec element itself (mock-v12.css)
 * -- wrapping it for drag handlers would put a non-.sec element where the
 * grid expects one. Drag handlers pass straight through to Card's own
 * <section> instead (onDragOver/onDrop props Card already accepts).
 */
import {
  cloneElement,
  useLayoutEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useSectionLayout } from "./sectionLayout";

export interface SectionSpec {
  id: string;
  element: ReactElement<{
    ref?: (element: HTMLElement | null) => void;
    className?: string;
    open?: boolean;
    onToggle?: () => void;
    dragHandle?: ReactNode;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
    onDragEnter?: (event: DragEvent<HTMLElement>) => void;
    onResizeToggle?: () => void;
  }>;
}

/** Whether a card's OWN declared className already spans both bento columns. */
function declaredWide(className: string | undefined): boolean {
  return (className ?? "").split(/\s+/).includes("wide");
}

/** `className`, with "wide" added or removed to match `wide`, everything else kept as-is. */
function withWideClass(className: string | undefined, wide: boolean): string {
  const rest = (className ?? "").split(/\s+/).filter((token) => token && token !== "wide");
  return wide ? [...rest, "wide"].join(" ") : rest.join(" ");
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

export default function SectionList({ tabId, sections }: SectionListProps) {
  const { order, isCollapsed, toggleCollapsed, reorder, wideOverride, toggleWide } = useSectionLayout(
    tabId,
    sections.map((section) => section.id),
  );
  const draggedId = useRef<string | null>(null);
  const byId = new Map(sections.map((section) => [section.id, section]));

  // FLIP reorder (user feedback 2026-08-01: "not fluid, not live"). When a
  // reorder/fold/resize actually happened since the last render, compare
  // each card's freshly measured position (and width, for resize) against
  // the one recorded last render, jump it back to where it was with no
  // transition, force one layout, then release the transition -- `.sec`
  // carries `transition: transform .2s ease-out, ...` (mock-v12.css +
  // mock-bridge.css) for its own hover lift, and that same rule is what
  // animates the release. Nothing here is a `:hover` rule, and this file has
  // no mousemove/pointermove listener, so neither no-hover-motion.test.ts
  // guard applies -- this is a state-driven reflow, not pointer-driven
  // painting.
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  // User feedback 2026-08-02: "selecting weapons makes everything move
  // everywhere". Root cause -- this effect ran on EVERY render, so a card
  // higher up growing/shrinking for an unrelated reason (a filter selection,
  // a date preset) cascades a real position shift to every card below it in
  // the grid, and all of them got FLIP-animated even though the user never
  // touched a card's order or size. Confirmed live: clicking a date preset
  // moved every single card, `dTop` in the tens/hundreds of pixels, nothing
  // to do with reorder/resize. The FLIP dance is scoped to genuine
  // order/collapse/wide changes now; an unrelated content reflow still moves
  // cards (correctly), it just does so with the plain, instant browser
  // reflow instead of a system-wide slide.
  const layoutSignature = JSON.stringify([
    order,
    order.map((id) => isCollapsed(id)),
    order.map((id) => wideOverride(id) ?? null),
  ]);
  const prevLayoutSignature = useRef<string | null>(null);

  useLayoutEffect(() => {
    const layoutChanged =
      prevLayoutSignature.current !== null && prevLayoutSignature.current !== layoutSignature;
    prevLayoutSignature.current = layoutSignature;

    if (layoutChanged) {
      for (const [id, el] of nodeRefs.current) {
        const prev = prevRects.current.get(id);
        if (!prev) continue;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        const dw = prev.width - next.width;
        if (!dx && !dy && !dw) continue;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        if (dw) el.style.width = `${prev.width}px`;
        el.getBoundingClientRect(); // forces the browser to commit the jump before releasing it
        el.style.transition = "";
        el.style.transform = "";
        if (dw) el.style.width = "";
      }
    }
    const rects = new Map<string, DOMRect>();
    for (const [id, el] of nodeRefs.current) rects.set(id, el.getBoundingClientRect());
    prevRects.current = rects;
  });

  return (
    <>
      {order.map((id) => {
        const spec = byId.get(id);
        if (!spec) return null;
        const defaultWide = declaredWide(spec.element.props.className);
        const wide = wideOverride(id) ?? defaultWide;
        return cloneElement(spec.element, {
          key: id,
          ref: (el: HTMLElement | null) => {
            if (el) nodeRefs.current.set(id, el);
            else nodeRefs.current.delete(id);
          },
          className: withWideClass(spec.element.props.className, wide),
          open: !isCollapsed(id),
          onToggle: () => toggleCollapsed(id),
          onResizeToggle: () => toggleWide(id, wide),
          // `preventDefault` alone -- required by the native drag API for
          // this element to accept a drop at all. The reorder itself happens
          // on `onDragEnter` below (user feedback 2026-08-02: reordering was
          // invisible until release); by the time `onDrop` fires the order
          // has already moved, this just ends the drag.
          onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
          onDragEnter: () => {
            if (draggedId.current && draggedId.current !== id) reorder(draggedId.current, id);
          },
          onDrop: () => {
            draggedId.current = null;
          },
          dragHandle: (
            <span
              className="drag-handle"
              draggable
              aria-label={`drag-${id}`}
              onClick={(event: MouseEvent) => event.stopPropagation()}
              onDragStart={() => {
                draggedId.current = id;
              }}
            >
              ⠿
            </span>
          ),
        });
      })}
    </>
  );
}
