import { useEffect, useRef, type ReactNode } from "react";

import "./Tab.css";

interface TabProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onSelect: () => void;
}

/**
 * One tab, extracted from the mock's `.tab` (mockup-v12-hologlass.html).
 */
export function Tab({ label, icon, active, onSelect }: TabProps) {
  const classes = active ? "tab active" : "tab";
  return (
    <button
      type="button"
      role="tab"
      className={classes}
      data-action="O1" onClick={onSelect}
      aria-selected={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
    >
      {icon}
      <span className="tk" aria-hidden="true" />
      {label}
    </button>
  );
}

interface TabBarProps {
  children: ReactNode;
}

/**
 * The two numbers the indicator's arithmetic needs, read from the mock.
 */
const TAB_SLANT = 18;
const IND_BASE_WIDTH = 100;

/**
 * Row layout for a set of `Tab`s, plus two sliding indicators — `.ind`
 * (bottom) and `.top-ind` (top accent bar). Both slide fluidly via
 * `translateX()` whenever the active tab changes.
 *
 * Uses the active tab's `offsetLeft` and `offsetWidth` (the same arithmetic
 * `.ind` always used), read inside `useEffect` so the DOM has committed the
 * new `.active` class before the indicators move. `[children]` dependency
 * forces a re-measure on every tab switch.
 */
export function TabBar({ children }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ind = bar.querySelector<HTMLElement>(".ind");
    const top = bar.querySelector<HTMLElement>(".top-ind");

    function moveIndicators() {
      const activeTab = bar.querySelector<HTMLElement>(".tab.active");
      if (!activeTab || !ind || !top) return;
      const scale = (activeTab.offsetWidth - TAB_SLANT) / IND_BASE_WIDTH;
      const tx = `translateX(${activeTab.offsetLeft}px) scaleX(${scale})`;
      ind.style.transform = tx;
      top.style.transform = tx;
    }

    moveIndicators();
    window.addEventListener("resize", moveIndicators);
    return () => window.removeEventListener("resize", moveIndicators);
  }, [children]);

  return (
    <div className="tabs" role="tablist" ref={barRef}>
      {children}
      <span className="ind" />
      <span className="top-ind" />
    </div>
  );
}
