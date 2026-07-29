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

/** A joined segmented control, extracted from the mock's `.seg` (ui-v5.html lines 93-98). */
export default function Segmented({ options, value, onChange, label, disabled }: SegmentedProps) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={!!disabled}
            className={checked ? "segment segment-selected" : "segment"}
            onClick={() => {
              if (!disabled) onChange(option);
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
