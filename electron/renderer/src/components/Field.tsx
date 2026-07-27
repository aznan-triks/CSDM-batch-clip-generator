import "./Field.css";

interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  id?: string;
  label?: string;
}

/** A real `<input>`, extracted from the mock's `.fld` (ui-v5.html lines 82-85). */
export default function Field({ value, onChange, mono, placeholder, id, label }: FieldProps) {
  const classes = mono ? "field field-mono" : "field";
  return (
    <div className="field-wrap">
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        type="text"
        className={classes}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
