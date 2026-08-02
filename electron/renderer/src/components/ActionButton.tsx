import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { MOTION } from "../motion/tokens";
import "./ActionButton.css";

type Variant = "run" | "preview" | "stop" | "kill";

/**
 * The approved mock has three button faces, not four: a plain one, a rose one,
 * and the filled pill. KILL and STOP share the rose face there, and they
 * already rendered identically here -- two rule blocks saying the same thing.
 * The variant stays four-valued because the caller means four different
 * actions; only the face is shared.
 */
const MOCK_FACE: Record<Variant, string> = {
  run: "primary",
  preview: "ghost",
  stop: "danger",
  kill: "danger",
};

interface ActionButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick"> {
  label: string;
  icon?: ReactNode;
  variant: Variant;
  armed?: boolean;
  onClick: () => void;
}

/**
 * Action button, wearing the approved mock's `.btn` and its effect layers.
 *
 * THE LAYERS, AND WHY THEY ARE NOT A WEAPON SEQUENCE (D18): `.bx` is the
 * glitch grid on hover, `.fl` the flash and `.brs` the conic burst on impact,
 * `.sb` the ring that turns forever on the primary button. All four are local
 * to the button and say one thing -- "I took your click". What a run DID is
 * the weapon band's job, and that is driven by the engine's own events through
 * `weapon/controller.ts`, which no click may call. A button that pretended a
 * run had started would be lying about the only thing that matters here.
 *
 * The impact class comes off on a TIMER, never on `onfinish`: `onfinish` does
 * not fire while the window is hidden, and the class would pile up
 * (CONTEXT_GUIDE section 10).
 */
export default function ActionButton({
  label,
  icon,
  variant,
  armed,
  disabled,
  onClick,
  ...rest
}: ActionButtonProps) {
  const [hit, setHit] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const markImpact = useCallback(() => {
    if (disabled) return;
    setHit(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHit(false), MOTION.buttonImpact.duration * 1000);
  }, [disabled]);

  const classes = ["btn", MOCK_FACE[variant], `btn-${variant}`, armed ? "btn-armed" : "", hit ? "hit" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      onMouseDown={markImpact}
      disabled={disabled}
      {...rest}
    >
      {/* Decorative layers, in the mock's own order. The ring is the primary
          button's alone -- on a quiet face it reads as a loading spinner. */}
      {variant === "run" && <span className="sb" aria-hidden="true" />}
      <span className="bx" aria-hidden="true" />
      <span className="fl" aria-hidden="true" />
      <span className="brs" aria-hidden="true" />
      {icon}
      {label}
    </button>
  );
}
