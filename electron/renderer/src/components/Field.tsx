import "./Field.css";

interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  id?: string;
  label?: string;
  /** `"password"` masks the value, for `pg_pass`. Everything else stays `"text"`. */
  type?: "text" | "password";
}

/**
 * A real `<input>`, wearing the approved mock's `.fld`, with the mock's `.lab`
 * beside it.
 *
 * NO WRAPPER, and that is the point. The mock puts the label and the field
 * side by side inside a `.row`, and `.fld { flex: 1; min-width: 90px }` shares
 * the space out from there. A wrapping block around the pair defeated all of
 * it: every field stretched to the card's full width -- one of them to 1246px
 * -- which is what made this tab read as a stack of banners instead of a dense
 * panel.
 */
export default function Field({ value, onChange, mono, placeholder, id, label, type }: FieldProps) {
  return (
    <>
      {label && (
        <label className="lab" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        type={type ?? "text"}
        className={mono ? "fld fld-mono" : "fld"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}
