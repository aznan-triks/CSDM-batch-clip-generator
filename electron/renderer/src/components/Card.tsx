import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode, useState } from "react";

import "./Card.css";

interface CardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Inline styles forwarded to the `<section>` itself. SectionList uses this
   * for the block-grid placement (`gridColumn`/`gridRow`) -- the grid's cells
   * are decided outside Card, never by a class here.
   */
  style?: CSSProperties;
  /**
   * The mock's `.sh .cnt`: the card's own summary, right-aligned in the
   * header -- "2 SELECTED", "4 RULES", "KILLER". Omitted when the card has
   * nothing to count.
   */
  count?: ReactNode;
  /** Controlled fold state. Omit both to keep the card's own internal state. */
  open?: boolean;
  onToggle?: () => void;
  /** A drag handle rendered in the header, before the icon. Only SectionList passes one. */
  dragHandle?: ReactNode;
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
 *
 * Forwards a ref to the `<section>` itself -- SectionList's own doing for
 * the block-grid placement, never read by anything decorative.
 */
const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    title,
    icon,
    children,
    className,
    style,
    count,
    open: openProp,
    onToggle,
    dragHandle,
  },
  ref,
) {
  // The mock's `.sec.closed`: the header is the toggle and the body folds
  // away. The window's own `Sec` has always worked this way -- a card that
  // cannot be folded turns a dense tab into a scroll marathon.
  //
  // `open`/`onToggle` (menus-C): SectionList persists the fold state across
  // reloads by controlling it from outside. Every other caller passes
  // neither, so `openProp` is undefined and this falls back to the internal
  // state exactly as before -- backward compatible by construction.
  const [internalOpen, setInternalOpen] = useState(true);
  const open = openProp ?? internalOpen;
  const toggle = onToggle ?? (() => setInternalOpen((previous) => !previous));
  const classes = ["sec", className, open ? null : "closed"].filter(Boolean).join(" ");

  return (
    <section
      ref={ref}
      className={classes}
      style={style}
      onMouseMove={paintSpotlight}
    >
      {/* The mock's four decorative layers. `.glx` and `.cbr` were drawn here
          as pseudo-elements on the card itself, which could carry the corners
          but not the flicker the mock gives them. */}
      <span className="glx" aria-hidden="true" />
      <span className="cbr tl" aria-hidden="true" />
      <span className="cbr br" aria-hidden="true" />
      <span className="spot" aria-hidden="true" />
      <h5 className="panel-heading">
        <button type="button" className="sh" aria-expanded={open} data-action="O4" onClick={toggle}>
          {dragHandle}
          {icon && <span className="gl">{icon}</span>}
          <span className="t">{title}</span>
          {count != null && <span className="cnt">{count}</span>}
          <span className="car" aria-hidden="true">
            ▾
          </span>
        </button>
      </h5>
      {/* User feedback 2026-08-01: no line ever separated the header from the
          body, or the mock never needed one on its own showcase cards. A
          dense settings card reads better with the boundary marked. */}
      {/* The body stays in the DOM when closed (mock-bridge.css folds it
          through grid-template-rows instead of the mock's `display:none`),
          so the collapse interpolates instead of snapping shut. The header
          button's `aria-expanded` keeps the state readable to assistive
          tech; `inert` hides the folded body from tab order and screen
          readers the same way unmounting used to. */}
      <div className="fold">
        <div className="fold-inner" inert={!open}>
          <span className="sep" aria-hidden="true" />
          {/* The grid decides this card's height; the body scrolls inside it
              rather than spilling past the card's own rectangle. */}
          <div className="sb sb-scroll">{children}</div>
        </div>
      </div>
    </section>
  );
});

export default Card;
