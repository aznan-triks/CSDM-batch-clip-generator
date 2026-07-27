import type { ReactNode } from "react";

import "./Card.css";

interface CardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
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
    <section className={classes}>
      <h5 className="panel-heading">
        {icon && <span className="panel-heading-icon">{icon}</span>}
        {title}
      </h5>
      <div className="panel-content">{children}</div>
    </section>
  );
}
