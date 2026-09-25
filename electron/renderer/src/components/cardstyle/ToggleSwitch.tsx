/** An on/off switch with its label: the V12 lime track. */
import "./cardstyle.css";

interface ToggleSwitchProps {
  label: string;
  on: boolean;
  tip?: string;
  onToggle: () => void;
}

export default function ToggleSwitch({ label, on, tip, onToggle }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={on ? "cs-switch on" : "cs-switch"}
      title={tip}
      onClick={onToggle}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}
