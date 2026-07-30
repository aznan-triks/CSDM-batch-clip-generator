import type { MouseEvent, ReactNode } from "react";

import "./Card.css";

interface CardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
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
export default function Card({ title, icon, children, className }: CardProps) {
  const classes = className ? `panel-box ${className}` : "panel-box";
  return (
    <section className={classes} onMouseMove={paintSpotlight}>
      <span className="spot" aria-hidden="true" />
      <h5 className="panel-heading">
        {icon && <span className="panel-heading-icon">{icon}</span>}
        {title}
      </h5>
      <div className="panel-content">{children}</div>
    </section>
  );
}
