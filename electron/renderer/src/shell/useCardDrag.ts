import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Pointer-driven card reordering (2026-08-02,
 * AUDIT_restyle6_polish_regressions.md #8), replacing HTML5 native
 * drag-and-drop entirely: reordering the DOM mid-drag is a known way to lose
 * dragenter/drop delivery once the element under the cursor moves out from
 * under it. Same pattern as AppShell.tsx's own console-resize drag --
 * `mousedown` starts it, `window` `mousemove`/`mouseup` run it for the
 * gesture's duration, no native drag API involved.
 *
 * Lives in its own file, never touching `.style.*`, so it can sit on
 * no-hover-motion.test.ts's CURSOR_DRIVEN_ALLOWLIST without that guard's
 * "no pointer-handler file writes a layout style" check ever needing to
 * reason about SectionList.tsx's own (unrelated) FLIP style writes.
 */
export function useCardDrag(reorder: (draggedId: string, targetId: string) => void) {
  const draggedId = useRef<string | null>(null);
  const lastTargetId = useRef<string | null>(null);

  const startDrag = useCallback(
    (id: string, resolveTargetId: (element: Element) => string | null) =>
      (event: ReactMouseEvent) => {
        event.preventDefault();
        draggedId.current = id;
        lastTargetId.current = id;

        function onMove(moveEvent: MouseEvent) {
          const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
          const targetId = hit && resolveTargetId(hit);
          if (!targetId || targetId === lastTargetId.current || !draggedId.current) return;
          lastTargetId.current = targetId;
          reorder(draggedId.current, targetId);
        }
        function onUp() {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          draggedId.current = null;
          lastTargetId.current = null;
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
    [reorder],
  );

  return { startDrag };
}
