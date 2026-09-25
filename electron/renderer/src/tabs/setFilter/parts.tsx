/**
 * Wrappers every set-filter view uses, so the setting wrappers and the action
 * markers sit the same way in all styles.
 */
import type { ReactNode } from "react";

import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import SettingControl from "../../settings/SettingControl";
import type { SetFilterModel, SetOption } from "./model";

/** The whole list, wrapped once when every option writes one list key. */
export function ListWrap({ m, children }: { m: SetFilterModel; children: ReactNode }) {
  return m.listKey ? <SettingControl settingKey={m.listKey}>{children}</SettingControl> : <>{children}</>;
}

/** One option, wrapped in its own key (unless the list owns one) and its marker. */
export function OptionWrap({ m, o, children }: { m: SetFilterModel; o: SetOption; children: ReactNode }) {
  const marked = <m.Mark>{children}</m.Mark>;
  return m.listKey ? marked : <SettingControl settingKey={o.settingKey}>{marked}</SettingControl>;
}

/** The master switch, as the lime switch. */
export function FilterSwitch({ m, label }: { m: SetFilterModel; label: string }) {
  return (
    <SettingControl settingKey={m.enabled.key}>
      <ToggleSwitch label={label} on={m.enabled.on} tip={m.enabled.tip} onToggle={m.enabled.toggle} />
    </SettingControl>
  );
}

/**
 * "3 of 13" / "all" / "none", for a card header. An enabled filter with
 * nothing picked is a run problem (the engine asks which ones), not "all".
 */
export function keptWords(m: SetFilterModel): string {
  if (!m.enabled.on) return "all";
  const n = m.options.filter((o) => o.on).length;
  return n ? `${n} of ${m.options.length}` : "none";
}
