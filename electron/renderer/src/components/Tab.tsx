import type { ReactNode } from "react";

import "./Tab.css";

interface TabProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onSelect: () => void;
}

/** One tab, extracted from the mock's `.tab` (ui-v5.html lines 45-59). */
export function Tab({ label, icon, active, onSelect }: TabProps) {
  const classes = active ? "tab tab-active" : "tab";
  return (
    <button type="button" className={classes} onClick={onSelect} aria-current={active ? "true" : undefined}>
      {icon && <span className="tab-icon">{icon}</span>}
      <span className="tab-label">{label}</span>
    </button>
  );
}

interface TabBarProps {
  children: ReactNode;
}

/** Row layout for a set of `Tab`s (mock `.tabs`, ui-v5.html line 45). */
export function TabBar({ children }: TabBarProps) {
  return <div className="tab-bar">{children}</div>;
}
