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
 * A panel with corner brackets and a heading bar, extracted from the mock's
 * `.pbox` (ui-v5.html lines 67-80).
 *
 * Named `panel*`, never `card`: the mock's own comment (lines 63-66) explains
 * that `.card` collided with a third-party class animating `translateY(-2px)`
 * on hover, which is exactly the motion-on-hover rule this project forbids.
 */
export default function Card({ title, icon, children, className, count }: CardProps) {
  // The mock's `.sec.closed`: the header is the toggle and the body folds
  // away. The window's own `Sec` has always worked this way -- a card that
  // cannot be folded turns a dense tab into a scroll marathon.
  const [open, setOpen] = useState(true);
  const classes = ["panel-box", className, open ? null : "panel-closed"]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} onMouseMove={paintSpotlight}>
      <span className="spot" aria-hidden="true" />
      <h5 className="panel-heading">
        <button
          type="button"
          className="panel-heading-btn"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {icon && <span className="panel-heading-icon">{icon}</span>}
          <span className="panel-heading-title">{title}</span>
          {count != null && <span className="panel-heading-count">{count}</span>}
          <span className="panel-heading-caret" aria-hidden="true">
            ▾
          </span>
        </button>
      </h5>
      {open && <div className="panel-content">{children}</div>}
    </section>
  );
}
