import "./Chip.css";

interface ChipProps {
  label: string;
  selected?: boolean;
  onToggle: () => void;
  /**
   * Greys the chip out and ignores clicks, without hiding it.
   *
   * Used while MATCH TYPES and the weapon grid wait for `connect_db` to
   * answer, and while a section's own master switch (`map_filter_enabled`,
   * for instance) is off: a hidden filter reads as a filter that does not
   * exist, so the window greys it instead. Same rule as `Segmented`'s
   * `disabled` prop.
   */
  disabled?: boolean;
}

/** A toggle chip, extracted from the mock's `.chip` (ui-v5.html lines 86-92). */
export default function Chip({ label, selected, onToggle, disabled }: ChipProps) {
  // `on`, not `chip-selected`: the mock's stylesheet is the base sheet and it
  // styles `.chip.on`. `chip-selected` had no rule in any stylesheet, so the
  // selected face never reached the screen -- across all 27 call sites.
  const classes = selected ? "chip on" : "chip";
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={!!selected}
      aria-disabled={!!disabled}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      {label}
    </button>
  );
}
