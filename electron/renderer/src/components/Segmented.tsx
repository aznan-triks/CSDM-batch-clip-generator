import "./Segmented.css";

interface SegmentedProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /**
   * Greys the control out and ignores clicks, without hiding it.
   *
   * Used for the headshot choice while ONE TAP or TROIS TAP is active: a
   * one-tap kill is already a headshot constraint, so combining them would
   * silently match nothing. Hiding the control would hide that rule; showing
   * it disabled keeps the rule visible.
   */
  disabled?: boolean;
}

/**
 * A joined segmented control, wearing the approved mock's `.seg`.
 *
 * The mock's segments are bare `<span>`s -- it is a picture, and a picture is
 * never operated. Here each segment is a real radio button, so the button is a
 * transparent shell around the span the mock's rules style. The keyboard and
 * the screen reader keep working, and the mock's segment styling is not
 * copied out to reach a different element.
 */
export default function Segmented({ options, value, onChange, label, disabled }: SegmentedProps) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={!!disabled}
            onClick={() => {
              if (!disabled) onChange(option);
            }}
          >
            <span className={checked ? "on" : undefined}>{option}</span>
          </button>
        );
      })}
    </div>
  );
}
