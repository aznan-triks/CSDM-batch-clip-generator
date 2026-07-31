import type { ReactNode } from "react";

import "./SettingControl.css";

/**
 * The wrapper every setting control wears.
 *
 * `data-config-key` is not decoration: it is how the coverage guard knows a
 * DEFAULT_CONFIG key reached the screen. A control that renders without this
 * wrapper counts as missing, on purpose -- the guard must measure what is
 * mounted, not what someone meant to mount.
 *
 * It is a marker and NOTHING ELSE. `display: contents` (SettingControl.css)
 * keeps the element for the guard and removes its box, so the control inside
 * lands in the row or grid its parent lays out. As a real block it broke every
 * one of them -- a label and a field meant to share a row each got a full line
 * instead.
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
