import "./Segmented.css";

interface SegmentedProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/** A joined segmented control, extracted from the mock's `.seg` (ui-v5.html lines 93-98). */
export default function Segmented({ options, value, onChange, label }: SegmentedProps) {
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
            className={checked ? "segment segment-selected" : "segment"}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
