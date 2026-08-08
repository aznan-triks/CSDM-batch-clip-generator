import { useCallback, useState } from "react";
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
 *
 * HOLOGRAPHIC PREVIEW (2026-08-08, workspace-vivant design §A2): the cards
 * no longer reorder while the pointer moves. mousemove only tracks the
 * current drop target (`currentTargetId`) so SectionList can paint a
 * placeholder there; the actual `reorder` commit happens exactly once, on
 * mouseup. Escape cancels the gesture without reordering. This is a plain
 * mousemove listener (not a `:hover` rule), so it stays inside the
 * no-hover-motion guard's pointer-driven carve-out.
 */
export function useCardDrag(reorder: (draggedId: string, targetId: string) => void) {
  // State, not refs: SectionList needs to re-render whenever the drag target
  // moves so the placeholder follows the pointer.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [currentTargetId, setCurrentTargetId] = useState<string | null>(null);

  const startDrag = useCallback(
    (id: string, resolveTargetId: (element: Element) => string | null) =>
      (event: ReactMouseEvent) => {
        event.preventDefault();
        // Gesture-local values: the window listeners are registered here and
        // live for the gesture's duration, so they can capture the drag id
        // and track the latest target without round-tripping through state.
        let target = id;
        setDraggedId(id);
        setCurrentTargetId(id);

        function end() {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("keydown", onKey);
          setDraggedId(null);
          setCurrentTargetId(null);
        }

        function onMove(moveEvent: MouseEvent) {
          const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
          const targetId = hit && resolveTargetId(hit);
          if (!targetId) return;
          // Track only -- no reorder here. The commit happens on mouseup.
          target = targetId;
          setCurrentTargetId(targetId);
        }

        function onUp() {
          end();
          // Commit exactly once, with the final target the pointer settled on.
          if (target !== id) reorder(id, target);
        }

        function onKey(keyEvent: KeyboardEvent) {
          // Cancel without committing: clear everything, nothing moves.
          if (keyEvent.key === "Escape") end();
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("keydown", onKey);
      },
    [reorder],
  );

  return { startDrag, draggedId, currentTargetId };
}
