import { useRef } from "react";

import "../components/Field.css";
import "./DateField.css";

interface DateFieldProps {
  id: string;
  label?: string;
  /** `dd-mm-yyyy`, or `""` for "no bound". Never a Date -- the config key IS this string. */
  value: string;
  onChange: (value: string) => void;
}

/** `dd-mm-yyyy` -> `yyyy-mm-dd` (what `<input type="date">` wants), or `""` if unparsable. */
function toIso(value: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** `yyyy-mm-dd` -> `dd-mm-yyyy`, or `""` if unparsable (the field was cleared). */
function fromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * The window's own `Entry` + 📅 button (`_tab_capturer`, `date_from`/`date_to`).
 *
 * The visible field is plain text in `dd-mm-yyyy` -- the same format the
 * engine's own date filter reads (`_qe_epoch_bounds`, core.py) -- so typing a
 * date needs no conversion. The calendar itself is a real `<input
 * type="date">`, kept off-screen and triggered by the button: shown as-is, it
 * would paint its own icon and popup in the platform's blue, the same
 * platform-blue problem `Slider.css` solves for the range thumb. `color-scheme:
 * dark` on the hidden input is the equivalent fix here -- the one lever CSS
 * has over a browser-native popup that no token can reach into.
 */
export default function DateField({ id, label, value, onChange }: DateFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null);

  function openCalendar() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    } else {
      picker.focus();
    }
  }

  return (
    <div className="date-field-wrap">
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="date-field-row">
        <input
          id={id}
          type="text"
          className="field field-mono date-field-text"
          placeholder="dd-mm-yyyy"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="date-field-btn"
          aria-label="Open calendar"
          onClick={openCalendar}
        >
          📅
        </button>
        <input
          ref={pickerRef}
          type="date"
          className="date-field-native"
          tabIndex={-1}
          aria-hidden="true"
          value={toIso(value)}
          onChange={(event) => onChange(fromIso(event.target.value))}
        />
      </div>
    </div>
  );
}
