import { type MouseEvent, type ReactNode, useState } from "react";

import "./Card.css";

interface CardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * The mock's `.sh .cnt`: the card's own summary, right-aligned in the
   * header -- "2 SELECTED", "4 RULES", "KILLER". Omitted when the card has
   * nothing to count.
   */
  count?: ReactNode;
}

/**
 * The spotlight border (restyle 4): a mousemove handler that paints ONLY
 * custom properties (`--mx`/`--my`), never a layout style. This is why
 * `Card.tsx` is on `CURSOR_DRIVEN_ALLOWLIST` in `no-hover-motion.test.ts`
 * instead of being banned outright -- painting is allowed, moving is not.
 */
function paintSpotlight(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

/**
 * A folding card, wearing the approved mock's `.sec` and everything it hangs
 * on it: the glitch veil, the two corner brackets, the header row and the
 * body.
 *
 * The header is ONE element in the mock -- the row IS the button. It was a
 * `<h5>` wrapping a `<button>` here, which is why it never looked like the
 * mock: a flex row laid out inside a block heading is not a flex row. The
 * heading stays, with `display: contents` (Card.css), so a screen reader can
 * still walk the tab by its card titles while the button becomes the row the
 * mock's rules address.
 */
export default function Card({ title, icon, children, className, count }: CardProps) {
  // The mock's `.sec.closed`: the header is the toggle and the body folds
  // away. The window's own `Sec` has always worked this way -- a card that
  // cannot be folded turns a dense tab into a scroll marathon.
  const [open, setOpen] = useState(true);
  const classes = ["sec", className, open ? null : "closed"].filter(Boolean).join(" ");

  return (
    <section className={classes} onMouseMove={paintSpotlight}>
      {/* The mock's four decorative layers. `.glx` and `.cbr` were drawn here
          as pseudo-elements on the card itself, which could carry the corners
          but not the flicker the mock gives them. */}
      <span className="glx" aria-hidden="true" />
      <span className="cbr tl" aria-hidden="true" />
      <span className="cbr br" aria-hidden="true" />
      <span className="spot" aria-hidden="true" />
      <h5 className="panel-heading">
        <button type="button" className="sh" aria-expanded={open} onClick={() => setOpen(!open)}>
          {icon && <span className="gl">{icon}</span>}
          <span className="t">{title}</span>
          {count != null && <span className="cnt">{count}</span>}
          <span className="car" aria-hidden="true">
            ▾
          </span>
        </button>
      </h5>
      {open && <div className="sb">{children}</div>}
    </section>
  );
}
