import type { ReactNode } from "react";

import "./ActionButton.css";

type Variant = "run" | "preview" | "stop" | "kill";

interface ActionButtonProps {
  label: string;
  icon?: ReactNode;
  variant: Variant;
  armed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Action button, extracted from the mock's `.btn` (ui-v5.html lines 105-131).
 *
 * The reflection sweep on `::before` is the ONE allowed hover motion in this
 * project -- a decorative gradient sweeping behind the label, never the
 * label itself. Its keyframe is named `sweep` so the no-motion-on-hover scan
 * can allowlist it by name.
 */
export default function ActionButton({
  label,
  icon,
  variant,
  armed,
  disabled,
  onClick,
}: ActionButtonProps) {
  const classes = ["btn", `btn-${variant}`, armed ? "btn-armed" : "", disabled ? "btn-disabled" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled}>
      {icon && <span className="btn-icon">{icon}</span>}
      <span className="btn-label">{label}</span>
    </button>
  );
}
