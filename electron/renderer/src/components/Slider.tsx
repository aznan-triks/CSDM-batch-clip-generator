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
  // The filled portion, as a percentage. A native range input paints no
  // progress of its own, and the mock's rail is filled lime-to-accent up to
  // the thumb -- so the value is handed to CSS as a custom property and the
  // gradient is drawn there. Painting only: nothing here moves a layout box.
  const span = max - min;
  const filled = span > 0 ? ((value - min) / span) * 100 : 0;

  return (
    <div className="slider" style={{ ["--fill" as string]: `${filled}%` }}>
      <label className="slider-label" htmlFor={id}>
        {label}
      </label>
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
      {readout && <span className="slider-readout">{readout}</span>}
    </div>
  );
}
