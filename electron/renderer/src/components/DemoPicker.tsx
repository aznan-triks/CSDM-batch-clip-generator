import "./DemoPicker.css";

export interface DemoCompat {
  status: "ok" | "warn" | "missing";
  break: string | null;
  tip: string | null;
}

/** One row of the picker, the shape `list_demos` (csdm/bridge/host.py) sends. */
export interface DemoRow {
  path: string;
  name: string;
  date: string;
  map: string;
  compat: DemoCompat;
}

interface DemoPickerProps {
  /** `null` before anything has populated the picker (no Preview yet, Manual mode off). */
  demos: DemoRow[] | null;
  checked: Record<string, boolean>;
  onToggle: (path: string) => void;
  onSetAll: (value: boolean) => void;
}

/**
 * The ✓ / Date / Map / Demo table (`_demo_tree`, `_tab_capturer`).
 *
 * A row's compat status never hides it -- the window greys an incompatible
 * demo and explains why on hover (`_tree_motion`'s tooltip), it never drops
 * the row outright, because dropping it would look like the demo was never
 * found at all. `title` carries the same explanation here; a screen reader or
 * a mouse hover both reach it the same way.
 */
export default function DemoPicker({ demos, checked, onToggle, onSetAll }: DemoPickerProps) {
  const rows = demos ?? [];
  const total = rows.length;
  const onCount = rows.filter((row) => checked[row.path]).length;

  return (
    <div className="demo-picker">
      <div className="dp-toolbar">
        <span className="dp-count">
          {total === 0 ? "no demos loaded" : `${onCount}/${total} selected`}
        </span>
        <div className="dp-buttons">
          <button type="button" className="dp-btn dp-btn-on" onClick={() => onSetAll(true)}>
            ✓ Check all
          </button>
          <button type="button" className="dp-btn dp-btn-off" onClick={() => onSetAll(false)}>
            ✕ Uncheck all
          </button>
        </div>
      </div>

      <div className="dp-table">
        <div className="dp-row dp-head">
          <span className="dp-col-check" />
          <span className="dp-col-date">Date</span>
          <span className="dp-col-map">Map</span>
          <span className="dp-col-name">Demo</span>
        </div>
        <div className="dp-body">
          {rows.length === 0 && (
            <p className="capture-hint">
              No demos loaded -- run a Preview, or turn on Manual mode.
            </p>
          )}
          {rows.map((row) => {
            const isOn = !!checked[row.path];
            const warn = row.compat.status === "warn";
            const missing = row.compat.status === "missing";
            const title = warn
              ? `Recorded before a CS2 breaking update (${row.compat.break}) -- ${row.compat.tip}`
              : missing
                ? "Demo file not found on disk"
                : undefined;
            const rowClasses = [
              "dp-row",
              !isOn && "dp-row-off",
              warn && "dp-row-warn",
              missing && "dp-row-missing",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={row.path} className={rowClasses} title={title}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isOn}
                  className="dp-check"
                  onClick={() => onToggle(row.path)}
                >
                  {isOn ? "✓" : "✕"}
                </button>
                <span className="dp-col-date">{row.date}</span>
                <span className="dp-col-map">{row.map}</span>
                <span className="dp-col-name">{row.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
