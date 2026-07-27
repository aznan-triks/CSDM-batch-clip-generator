import "./Chip.css";

interface ChipProps {
  label: string;
  selected?: boolean;
  onToggle: () => void;
}

/** A toggle chip, extracted from the mock's `.chip` (ui-v5.html lines 86-92). */
export default function Chip({ label, selected, onToggle }: ChipProps) {
  const classes = selected ? "chip chip-selected" : "chip";
  return (
    <button type="button" className={classes} aria-pressed={!!selected} onClick={onToggle}>
      {label}
    </button>
  );
}
