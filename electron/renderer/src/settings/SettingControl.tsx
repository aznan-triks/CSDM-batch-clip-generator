import type { ReactNode } from "react";

/**
 * The wrapper every setting control wears.
 *
 * `data-config-key` is not decoration: it is how the coverage guard knows a
 * DEFAULT_CONFIG key reached the screen. A control that renders without this
 * wrapper counts as missing, on purpose -- the guard must measure what is
 * mounted, not what someone meant to mount.
 */
export default function SettingControl({
  settingKey,
  children,
}: {
  settingKey: string;
  children: ReactNode;
}) {
  return (
    <div className="setting" data-config-key={settingKey}>
      {children}
    </div>
  );
}
