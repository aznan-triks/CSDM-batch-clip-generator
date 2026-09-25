/**
 * The Demo Selection card's controls, drawn by all three styles.
 *
 * Each lives here once with its setting key wrapper, its tooltip and its
 * parity marker (F2-F5; F1 is DateField's own default), so a style only
 * chooses where it sits and which look it wears.
 */
import Chip from "../../components/Chip";
import DateField from "../../components/DateField";
import DemoPicker from "../../components/DemoPicker";
import SettingControl from "../../settings/SettingControl";
import {
  DATE_SHORTCUTS,
  DEMO_TIPS,
  parseDay,
  rangeForShortcut,
  type DemoSelectionModel,
} from "./useDemoSelection";

export function DateFrom({ m, label = "From" }: { m: DemoSelectionModel; label?: string }) {
  return (
    <SettingControl settingKey="date_from">
      <DateField id="date-from" label={label} tip={DEMO_TIPS.from} value={m.from} onChange={m.setFrom} />
    </SettingControl>
  );
}

export function DateTo({ m, label = "To" }: { m: DemoSelectionModel; label?: string }) {
  return (
    <SettingControl settingKey="date_to">
      <div className="ds-date-to">
        <DateField id="date-to" label={label} tip={DEMO_TIPS.to} value={m.to} onChange={m.setTo} dataAction="F2" />
        <button type="button" className="chip" data-action="F5" title={DEMO_TIPS.today} onClick={m.setToday}>
          Today
        </button>
      </div>
    </SettingControl>
  );
}

/** `dd-mm` of a `dd-mm-yyyy`, for a short caption. */
function dayMonth(value: string): string {
  return parseDay(value) ? value.slice(0, 5) : "";
}

function CalendarIcon({ text }: { text: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="32" height="29" rx="6" fill="currentColor" opacity="0.12" />
      <rect x="4" y="7" width="32" height="29" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M4 15h32" stroke="currentColor" strokeWidth="2" />
      <path d="M12 4v6M28 4v6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <text x="20" y="30" textAnchor="middle" fontSize={text.length > 2 ? 9 : 11} fontWeight="800" fill="currentColor">
        {text}
      </text>
    </svg>
  );
}

/** What a shortcut's calendar icon says: "7d" -> "7", "This month" -> "M"... */
const ICON_TEXT: Record<string, string> = {
  Yesterday: "-1",
  "7d": "7",
  "30d": "30",
  "This month": "M",
  "3m": "3M",
  "6m": "6M",
  Year: "Y",
  All: "∞",
};

/**
 * The shortcut row. `chip`: the window's own small buttons; `tile`: a
 * calendar tile per shortcut, with the dates it would set under its name.
 */
export function Shortcuts({ m, look = "chip" }: { m: DemoSelectionModel; look?: "chip" | "tile" }) {
  return (
    <>
      {DATE_SHORTCUTS.map((shortcut) => {
        // Lit when the dates on screen ARE this shortcut's range today, so
        // "which range is active" reads at a glance (audit 2026-09-25, A).
        const active = m.activeShortcut?.label === shortcut.label;
        if (look === "chip") {
          return (
            <button
              key={shortcut.label}
              type="button"
              className={active ? "chip on" : "chip"}
              aria-pressed={active}
              title={shortcut.title}
              data-action="F3"
              onClick={() => m.applyShortcut(shortcut)}
            >
              {shortcut.label}
            </button>
          );
        }
        const range = rangeForShortcut(shortcut);
        const caption = range.from ? `${dayMonth(range.from)} → ${dayMonth(range.to)}` : "no date limit";
        return (
          <button
            key={shortcut.label}
            type="button"
            className={active ? "ds-tile on" : "ds-tile"}
            aria-pressed={active}
            aria-label={shortcut.label}
            title={shortcut.title}
            data-action="F3"
            onClick={() => m.applyShortcut(shortcut)}
          >
            <span className="ds-tile-ic">
              <CalendarIcon text={ICON_TEXT[shortcut.label] ?? ""} />
            </span>
            <b>{shortcut.label}</b>
            <small>{caption}</small>
          </button>
        );
      })}
    </>
  );
}

export function ClearAll({ m }: { m: DemoSelectionModel }) {
  return (
    <button type="button" className="chip" data-action="F4" title={DEMO_TIPS.clearAll} onClick={m.clearAll}>
      Clear all
    </button>
  );
}

export function ManualMode({ m }: { m: DemoSelectionModel }) {
  return (
    <>
      <Chip
        label="Manual mode (load ALL demos from DB)"
        tip={DEMO_TIPS.manual}
        selected={m.manualMode}
        onToggle={m.toggleManualMode}
      />
      {m.error && <span className="ds-error">{m.error}</span>}
    </>
  );
}

export function Picker({ m }: { m: DemoSelectionModel }) {
  return (
    <DemoPicker
      demos={m.demos}
      checked={m.checked}
      onToggle={m.toggleDemo}
      onSetAll={m.setAllDemos}
      onSetSelected={m.setSelectedDemos}
    />
  );
}
