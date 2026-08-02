import { pickPath } from "../bridge";
import "./Field.css";
import "./PathField.css";

interface PathFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  label?: string;
  /** `"file"` opens the native file picker, `"dir"` (default) the folder picker. */
  mode?: "file" | "dir";
}

/**
 * A `Field` plus a native "Browse…" button, ported from `PathField` in
 * csdm_batch_clips_generator.py (`_tab_outils`'s PATHS section).
 *
 * The renderer cannot touch the filesystem directly (contextIsolation), so
 * the button asks the main process through `pickPath` and writes back
 * whatever it resolves to -- `null` on Cancel leaves the typed value alone.
 */
export default function PathField({ value, onChange, placeholder, id, label, mode = "dir" }: PathFieldProps) {
  async function browse() {
    const picked = await pickPath({ file: mode === "file" });
    if (picked !== null) onChange(picked);
  }

  return (
    <div className="path-field">
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="path-field-row">
        <input
          id={id}
          type="text"
          className="field path-field-input"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="path-field-browse" data-action="M12" onClick={browse}>
          Browse…
        </button>
      </div>
    </div>
  );
}
