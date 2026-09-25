import type { ReactNode } from "react";
import "./FormGroup.css";

interface FormGroupProps {
  /** What the rows below have in common, in a few words ("Clip length"). */
  title: string;
  children: ReactNode;
}

/**
 * A titled block of setting rows inside a card.
 *
 * A card that mixes several kinds of choice (what to capture, how it is
 * filmed, how long) read as one flat list of unrelated rows. Each group gets
 * a quiet caption in the voice of the mock's stat keys (`.st .k`) and one
 * shared label column, so every control inside starts at the same x.
 */
export default function FormGroup({ title, children }: FormGroupProps) {
  return (
    <section className="fgroup" aria-label={title}>
      <h4 className="fgroup-t">{title}</h4>
      {children}
    </section>
  );
}
