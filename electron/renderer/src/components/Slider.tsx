import "./Slider.css";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  /** Text shown at the right of the label row, e.g. "3s" or "total before: 5s". */
  readout?: string;
  id?: string;
}

/**
 * A numeric slider, for the window's `tk.Scale` rows.
 *
 * Built on a real `<input type="range">` so keyboard control, screen readers
 * and drag behaviour come for free -- but with `appearance: none` everywhere
 * in Slider.css, because the native control paints its track and thumb in the
 * platform's own blue, which is exactly the hardcoded colour D9 forbids.
 *
 * No hover rule in Slider.css may move anything (D13/D16); the thumb changes
 * colour only.
 */
export default function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  readout,
  id,
}: SliderProps) {
  return (
    <div className="slider">
      <div className="slider-head">
        <label className="slider-label" htmlFor={id}>
          {label}
        </label>
        {readout && <span className="slider-readout">{readout}</span>}
      </div>
      <input
        id={id}
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
