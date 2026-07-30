import type { ReactNode } from "react";

import { Tab, TabBar } from "../components/Tab";
import "./HudNav.css";

interface HudNavTab<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface HudNavProps<T extends string> {
  tabs: HudNavTab<T>[];
  active: T;
  onSelect: (id: T) => void;
}

/**
 * The top nav band (mock `.hud-nav`, mockup-v12-hologlass.html lines 61-95):
 * brand mark + the tab row, always. `.navtools` (the mock's status pill on
 * the right) is not reproduced -- there is no existing data to show there
 * without inventing one.
 */
export default function HudNav<T extends string>({ tabs, active, onSelect }: HudNavProps<T>) {
  return (
    <div className="hud-nav">
      <div className="hud-brand">
        <span className="hud-mark" aria-hidden="true" />
        <span className="hud-brand-name">CSDM</span>
      </div>
      <TabBar>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            label={tab.label}
            icon={tab.icon}
            active={tab.id === active}
            onSelect={() => onSelect(tab.id)}
          />
        ))}
      </TabBar>
    </div>
  );
}
