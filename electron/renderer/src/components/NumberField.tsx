import "./Slider.css";

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Reused as the accessible name, so the box says what it holds. */
  label: string;
  id?: string;
  /** Hover explanation, e.g. unit or valid range not shown elsewhere. */
  tip?: string;
}

/**
 * The typed half of a gauge.
 *
 * A range input cannot be typed into, and the window's numbers are seconds and
 * counts a user knows exactly ("7 seconds before"). Dragging to a precise value
 * inside a 1..15 range is fiddly; this is the box that takes it directly.
 *
 * Clamping lives here rather than in the caller: a free box can hold 99 or -3,
 * and the rail beside it cannot. An empty box reports nothing at all -- the
 * user is mid-edit, and `Number("")` is 0, which would silently jump the value.
 */
export default function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  label,
  id,
  tip,
}: NumberFieldProps) {
  return (
    <input
      id={id ? `${id}-number` : undefined}
      type="number"
      className="slider-number"
      aria-label={label}
      title={tip}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw.trim() === "") return;
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) return;
        onChange(Math.min(max, Math.max(min, parsed)));
      }}
    />
  );
}
