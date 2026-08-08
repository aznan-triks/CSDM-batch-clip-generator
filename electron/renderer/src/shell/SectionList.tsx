/**
 * Renders one tab's cards on a block grid: every card occupies explicit
 * grid-column / grid-row cells persisted in `ui_sections`.  No auto-flow,
 * no reordering of neighbours.
 *
 *  - Drag (⠿ handle) moves a card to a free cell, snapped to the grid; a
 *    dashed `.card-ghost` shows the target while nothing moves.
 *  - Resize (bottom-right corner) drags the card's span: the corner follows
 *    the pointer cell by cell, and the new col/row span is committed on
 *    mouseup.
 */
import {
  cloneElement,
  useLayoutEffect,
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
    /** Wired to the card's corner bracket; starts a resize drag. */
    onResizeToggle?: (event: MouseEvent) => void;
  }>;
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

function readColumnCount(): number {
  if (typeof document === "undefined") return 3;
  const el = document.querySelector('[role="tabpanel"] .bento');
  if (!el) return 3;
  return getComputedStyle(el).gridTemplateColumns.split(" ").length;
}

/** The grid gap, kept in sync with `--block-gap` in mock-bridge.css. */
const GRID_GAP = 10;

/** Pointer → grid cell (1-indexed), clamping to the visible column count. */
function cellFromPointer(
  moveEvent: { clientX: number; clientY: number },
  blockSize: number,
): { col: number; row: number } {
  const bento = document.querySelector(".bento");
  if (!bento) return { col: 1, row: 1 };
  const rect = bento.getBoundingClientRect();
  const x = moveEvent.clientX - rect.left;
  const y = moveEvent.clientY - rect.top;
  const col = Math.max(1, Math.min(readColumnCount(), Math.floor(x / (blockSize + GRID_GAP)) + 1));
  const row = Math.max(1, Math.floor(y / (blockSize + GRID_GAP)) + 1);
  return { col, row };
}

export default function SectionList({ tabId, sections }: SectionListProps) {
  const layout = useSectionLayout(tabId, sections.map((s) => s.id));
  const byId = new Map(sections.map((s) => [s.id, s]));

  // On first render the `.bento` does not exist in the DOM yet, so the
  // column count reads as the 2-column fallback and auto-placement stacks
  // every card. Re-render once the layout is committed so slot() re-places
  // on the real grid; re-run whenever the pane resizes (column count changes).
  const [, forceRender] = useState(0);
  useLayoutEffect(() => {
    forceRender((n) => n + 1);
    const bento = document.querySelector('[role="tabpanel"] .bento');
    if (!bento || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => forceRender((n) => n + 1));
    observer.observe(bento);
    return () => observer.disconnect();
  }, []);

  // --- Drag (move) state ---
  const [dragging, setDragging] = useState<string | null>(null);
  const targetCellRef = useRef<{ col: number; row: number } | null>(null);
  const [targetCellDisplay, setTargetCellDisplay] = useState<{ col: number; row: number } | null>(null);

  // --- Resize state ---
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeOriginRef = useRef<{ col: number; row: number } | null>(null);
  const resizePreviewRef = useRef<{ colSpan: number; rowSpan: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ colSpan: number; rowSpan: number } | null>(null);

  const nodeRefs = useRef(new Map<string, HTMLElement>());

  function startDrag(id: string) {
    return (event: MouseEvent) => {
      event.preventDefault();
      setDragging(id);
      const initial = { col: layout.slot(id).col, row: layout.slot(id).row };
      targetCellRef.current = initial;
      setTargetCellDisplay(initial);

      function onMove(moveEvent: globalThis.MouseEvent) {
        const cell = cellFromPointer(moveEvent, layout.blockSize());
        targetCellRef.current = cell;
        setTargetCellDisplay(cell);
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

  function startResize(id: string) {
    return (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setResizing(id);
      const slot = layout.slot(id);
      resizeOriginRef.current = { col: slot.col, row: slot.row };
      const initial = { colSpan: slot.colSpan, rowSpan: slot.rowSpan };
      resizePreviewRef.current = initial;
      setResizePreview(initial);

      function onMove(moveEvent: globalThis.MouseEvent) {
        const origin = resizeOriginRef.current;
        if (!origin) return;
        const cell = cellFromPointer(moveEvent, layout.blockSize());
        const colSpan = Math.max(1, cell.col - origin.col + 1);
        const rowSpan = Math.max(1, cell.row - origin.row + 1);
        resizePreviewRef.current = { colSpan, rowSpan };
        setResizePreview({ colSpan, rowSpan });
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (resizePreviewRef.current) {
          layout.resize(id, resizePreviewRef.current.colSpan, resizePreviewRef.current.rowSpan);
        }
        setResizing(null);
        setResizePreview(null);
        resizeOriginRef.current = null;
        resizePreviewRef.current = null;
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const allIds = sections.map((s) => s.id);
  const anyGesture = dragging !== null || resizing !== null;

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
          onResizeToggle: startResize(id),
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
      {resizing && resizePreview && (
        <div
          className="card-ghost card-ghost-resize"
          aria-hidden="true"
          style={
            {
              gridColumn: `${resizeOriginRef.current?.col ?? 1} / span ${resizePreview.colSpan}`,
              gridRow: `${resizeOriginRef.current?.row ?? 1} / span ${resizePreview.rowSpan}`,
            } as CSSProperties
          }
        />
      )}
      {/* During any gesture the grid is inert, so pointer events cannot hit
          the ghost previews (they are also pointer-events: none). */}
      {anyGesture && <div className="grid-gesture-guard" aria-hidden="true" />}
    </>
  );
}
