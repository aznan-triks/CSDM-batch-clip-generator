/**
 * The one control that removes something.
 *
 * There were three, all written separately (AUDIT_retours_ui_8_points.md,
 * ecart E4): the Tags pill (a real `<button>`, 28x31, square-cornered), the
 * registered-player cross (a `<span role="button">` positioned ON TOP of a
 * real `<button>` -- two controls inside one another), and the demo picker's
 * "uncheck" buttons, which spell the glyph a different way. Nothing was
 * shared, so nothing kept them in step, and they drifted apart in glyph, tag,
 * size and shape.
 *
 * The Tags one is the model, on the user's instruction: it is the only one
 * that is a proper button, sits beside what it removes rather than over it,
 * and asks before doing anything irreversible.
 */
import "./CloseButton.css";

/**
 * HC.1: the glyph, once, for the whole application.
 *
 * Exported because the demo picker spells its own labels ("Uncheck all") and
 * needs the same mark in front of them -- the alternative is a second literal
 * in the source, which is precisely how the three versions happened.
 */
export const CLOSE_GLYPH = "×";

export interface CloseButtonProps {
  /**
   * What this removes, in words. Becomes the accessible name -- the glyph
   * alone reads as "times" to a screen reader, which names nothing.
   */
  label: string;
  /** The hover explanation. A removal must always say what it removes. */
  title: string;
  onClick: () => void;
  /** The inventory code for this control, when it has one. */
  dataAction?: string;
}

export default function CloseButton({ label, title, onClick, dataAction }: CloseButtonProps) {
  return (
    <button
      type="button"
      className="chip close-btn"
      aria-label={label}
      title={title}
      data-action={dataAction}
      onClick={(event) => {
        // The pair sits inside rows that are themselves clickable (a player
        // chip toggles selection). Removing something must never also do the
        // thing the row does.
        event.stopPropagation();
        onClick();
      }}
    >
      {CLOSE_GLYPH}
    </button>
  );
}

/**
 * The thing and its remove button, joined into one visual unit.
 *
 * Two separate buttons, side by side with no gap -- never a button inside a
 * button, which is what the registered-player chip was doing.
 */
export function ChipPair({ children }: { children: React.ReactNode }) {
  return <span className="chip-pair">{children}</span>;
}
