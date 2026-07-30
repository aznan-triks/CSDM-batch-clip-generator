import { useLayoutEffect, useRef, type ReactNode } from "react";

import "./Tab.css";

interface TabProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onSelect: () => void;
}

/** One tab, extracted from the mock's `.tab` (mockup-v12-hologlass.html lines 76-89). */
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

/**
 * These two constants are geometry local to this component, not global
 * design tokens -- same treatment as `--log-pad`/`--log-line` in
 * LogConsole.css (restyle 1).
 */
const TAB_SLANT = 18; // kept in step with --sp-7 in Tab.css's clip-path
const IND_BASE_WIDTH = 100; // kept in step with .tab-ind's fixed CSS width

/**
 * Row layout for a set of `Tab`s (mock `.tabs`), plus the sliding `.tab-ind`
 * underline (mock `moveInd`, mockup-v12-hologlass.html lines 465-476) that
 * always sits under whichever child carries `.tab-active`.
 */
export function TabBar({ children }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    function moveIndicator() {
      const bar = barRef.current;
      const ind = indRef.current;
      if (!bar || !ind) return;
      const activeTab = bar.querySelector<HTMLElement>(".tab-active");
      if (!activeTab) return;
      const scale = (activeTab.offsetWidth - TAB_SLANT) / IND_BASE_WIDTH;
      ind.style.transform = `translateX(${activeTab.offsetLeft}px) scaleX(${scale})`;
    }

    moveIndicator();
    window.addEventListener("resize", moveIndicator);
    return () => window.removeEventListener("resize", moveIndicator);
  });

  return (
    <div className="tab-bar" ref={barRef}>
      {children}
      <span className="tab-ind" ref={indRef} />
    </div>
  );
}
