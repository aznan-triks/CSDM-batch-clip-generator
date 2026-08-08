/**
 * Renders one tab's cards on a block grid: every card occupies explicit
 * grid-column / grid-row cells persisted in `ui_sections`.  No auto-flow,
 * no reordering of neighbours -- drag snaps a card to a free cell, resize
 * cycles column span 1→2→3→1, row span 1→2→3→1.
 */
import {
  cloneElement,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useSectionLayout } from "./sectionLayout";
import type { CardSlot } from "./sectionLayout";

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
    onResizeToggle?: () => void;
  }>;
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

function readColumnCount(): number {
  if (typeof document === "undefined") return 3;
  const el = document.querySelector(".bento");
  if (!el) return 3;
  return getComputedStyle(el).gridTemplateColumns.split(" ").length;
}

export default function SectionList({ tabId, sections }: SectionListProps) {
  const layout = useSectionLayout(tabId, sections.map((s) => s.id));
  const byId = new Map(sections.map((s) => [s.id, s]));

  // --- Drag state (targetCell is a ref so onUp always reads the latest) ---
  const [dragging, setDragging] = useState<string | null>(null);
  const targetCellRef = useRef<{ col: number; row: number } | null>(null);
  const [targetCellDisplay, setTargetCellDisplay] = useState<{ col: number; row: number } | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());

  function startDrag(id: string) {
    return (event: MouseEvent) => {
      event.preventDefault();
      setDragging(id);
      const initial = { col: layout.slot(id).col, row: layout.slot(id).row };
      targetCellRef.current = initial;
      setTargetCellDisplay(initial);

      function onMove(moveEvent: globalThis.MouseEvent) {
        const bento = document.querySelector(".bento");
        if (!bento) return;
        const rect = bento.getBoundingClientRect();
        const bs = layout.blockSize();
        const gap = 10;
        const x = moveEvent.clientX - rect.left;
        const y = moveEvent.clientY - rect.top;
        const col = Math.max(1, Math.min(readColumnCount(), Math.floor(x / (bs + gap)) + 1));
        const row = Math.max(1, Math.floor(y / (bs + gap)) + 1);
        targetCellRef.current = { col, row };
        setTargetCellDisplay({ col, row });
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (targetCellRef.current) {
          layout.place(id, targetCellRef.current.col, targetCellRef.current.row);
        }
        setDragging(null);
        setTargetCellDisplay(null);
        targetCellRef.current = null;
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const resizeCard = useCallback(
    (id: string) => {
      const slot = layout.slot(id);
      const nextCol = slot.colSpan >= 3 ? 1 : slot.colSpan + 1;
      const nextRow = slot.rowSpan >= 3 ? 1 : slot.rowSpan + 1;
      layout.resize(id, nextCol, nextRow);
    },
    [layout],
  );

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
          onResizeToggle: () => resizeCard(id),
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
      {dragging && targetCellDisplay && (
        <div
          className="card-ghost"
          aria-hidden="true"
          style={
            {
              gridColumn: `${targetCellDisplay.col} / span ${layout.slot(dragging).colSpan}`,
              gridRow: `${targetCellDisplay.row} / span ${layout.slot(dragging).rowSpan}`,
            } as CSSProperties
          }
        />
      )}
    </>
  );
}
