/**
 * Renders one tab's cards on a block grid: every card occupies explicit
 * grid-column / grid-row cells persisted in `ui_sections`.  No auto-flow,
 * no reordering of neighbours -- drag snaps a card to a free cell, resize
 * changes its column/row span.
 */
import {
  cloneElement,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useSectionLayout } from "./sectionLayout";
import type { CardSlot } from "./sectionLayout";

/** Re-export so consumers don't need to know the internal path. */
export type { CardSlot };

export interface SectionSpec {
  id: string;
  element: ReactElement<{
    ref?: (element: HTMLElement | null) => void;
    className?: string;
    style?: CSSProperties;
    open?: boolean;
    onToggle?: () => void;
    dragHandle?: ReactNode;
    /** Called when the user drags the resize handle. */
    onResize?: (dx: number, dy: number) => void;
  }>;
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

/** Return the CSS grid track count for the bento container, or 3 as fallback. */
function readColumnCount(): number {
  if (typeof document === "undefined") return 3;
  const el = document.querySelector(".bento");
  if (!el) return 3;
  return getComputedStyle(el).gridTemplateColumns.split(" ").length;
}

export default function SectionList({ tabId, sections }: SectionListProps) {
  const layout = useSectionLayout(tabId, sections.map((s) => s.id));
  const byId = new Map(sections.map((s) => [s.id, s]));

  // --- Drag state ---
  const [dragging, setDragging] = useState<string | null>(null);
  const [targetCell, setTargetCell] = useState<{ col: number; row: number } | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());

  // --- Drag handlers ---
  function startDrag(id: string) {
    return (event: MouseEvent) => {
      event.preventDefault();
      setDragging(id);
      setTargetCell({ col: layout.slot(id).col, row: layout.slot(id).row });

      function onMove(moveEvent: globalThis.MouseEvent) {
        const bento = document.querySelector(".bento");
        if (!bento) return;
        const rect = bento.getBoundingClientRect();
        const bs = layout.blockSize();
        const gap = 10; // matches the grid gap
        const x = moveEvent.clientX - rect.left;
        const y = moveEvent.clientY - rect.top;
        const col = Math.max(1, Math.min(readColumnCount(), Math.floor(x / (bs + gap)) + 1));
        const row = Math.max(1, Math.floor(y / (bs + gap)) + 1);
        setTargetCell({ col, row });
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (targetCell) {
          layout.place(id, targetCell.col, targetCell.row);
        }
        setDragging(null);
        setTargetCell(null);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  // --- Compute ordered ids for rendering ---
  const allIds = sections.map((s) => s.id);

  return (
    <>
      {allIds.map((id) => {
        const spec = byId.get(id);
        if (!spec) return null;
        const slot = layout.slot(id);
        const ghost = id === dragging;

        return cloneElement(spec.element, {
          key: id,
          ref: (el: HTMLElement | null) => {
            if (el) nodeRefs.current.set(id, el);
            else nodeRefs.current.delete(id);
          },
          className: spec.element.props.className,
          style: {
            ...spec.element.props.style,
            gridColumn: `${slot.col} / span ${slot.colSpan}`,
            gridRow: `${slot.row} / span ${slot.rowSpan}`,
            opacity: ghost ? 0.35 : undefined,
            pointerEvents: ghost ? "none" : undefined,
          } as CSSProperties,
          open: !layout.isCollapsed(id),
          onToggle: () => layout.toggleCollapsed(id),
          dragHandle: (
            <span
              className="drag-handle"
              aria-label={`drag-${id}`}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              onMouseDown={startDrag(id)}
            >
              ⠿
            </span>
          ),
        });
      })}
      {/* Holographic target preview */}
      {dragging && targetCell && (
        <div
          className="card-ghost"
          aria-hidden="true"
          style={
            {
              gridColumn: `${targetCell.col} / span ${layout.slot(dragging).colSpan}`,
              gridRow: `${targetCell.row} / span ${layout.slot(dragging).rowSpan}`,
            } as CSSProperties
          }
        />
      )}
    </>
  );
}
