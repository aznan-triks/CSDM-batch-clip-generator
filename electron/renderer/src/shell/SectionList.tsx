/**
 * Renders one tab's cards in persisted order, with drag-to-reorder.
 *
 * No wrapper element around a Card: `.bento` is `display:grid` and `.wide`
 * spans it via `grid-column:1/-1` on the .sec element itself (mock-v12.css)
 * -- wrapping it for drag handlers would put a non-.sec element where the
 * grid expects one. Drag handlers pass straight through to Card's own
 * <section> instead (onDragOver/onDrop props Card already accepts).
 */
import { cloneElement, useRef, type DragEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";

import { useSectionLayout } from "./sectionLayout";

export interface SectionSpec {
  id: string;
  element: ReactElement<{
    open?: boolean;
    onToggle?: () => void;
    dragHandle?: ReactNode;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
  }>;
}

interface SectionListProps {
  tabId: string;
  sections: readonly SectionSpec[];
}

export default function SectionList({ tabId, sections }: SectionListProps) {
  const { order, isCollapsed, toggleCollapsed, reorder } = useSectionLayout(
    tabId,
    sections.map((section) => section.id),
  );
  const draggedId = useRef<string | null>(null);
  const byId = new Map(sections.map((section) => [section.id, section]));

  return (
    <>
      {order.map((id) => {
        const spec = byId.get(id);
        if (!spec) return null;
        return cloneElement(spec.element, {
          key: id,
          open: !isCollapsed(id),
          onToggle: () => toggleCollapsed(id),
          onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
          onDrop: () => {
            if (draggedId.current) reorder(draggedId.current, id);
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
