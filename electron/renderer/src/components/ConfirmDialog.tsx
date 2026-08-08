import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Renders the Confirm button with the destructive `.chip.danger` face. */
  danger?: boolean;
}

/**
 * A reusable destructive-action confirmation, mirroring the console's
 * `#ask-panel` (`LogConsole.tsx`): the same glass surface, token borders and
 * chip buttons, but as a modal overlay rendered into `document.body` so it
 * sits above the whole window rather than inside a card.
 *
 * Policy (spec Section C): every irreversible renderer action goes through
 * this component before it runs -- deleting a tag, removing tags from demos,
 * deleting a preset.
 *
 * Rendered through a portal so the overlay escapes any card/tab stacking
 * context and covers the window; the basic focus trap is auto-focusing the
 * Cancel button on open so keyboard users land on the safe choice first.
 */
export default function ConfirmDialog({ title, message, onCancel, onConfirm, danger }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return createPortal(
    <div className="confirm-backdrop">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="chip" onClick={onCancel} ref={cancelRef} data-action="D1">
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "chip danger" : "chip"}
            onClick={onConfirm}
            data-action="D2"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
