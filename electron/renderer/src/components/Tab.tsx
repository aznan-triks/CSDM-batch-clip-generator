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
 * Positioning is driven by a MutationObserver on the `.tabs` container, NOT by
 * a React effect keyed on `[children]`. A React effect depends on the parent
 * re-rendering with a new `children` reference; under production React (no
 * StrictMode double-render) a fast tab switch can be batched into a render
 * whose children reference the effect misses, leaving `.top-ind` one tab
 * behind while `.ind` — driven by the same effect — appears correct. The
 * observer watches the DOM itself: the moment any child's `class` attribute
 * changes (`.tab` gaining/losing `.active`), both bars are re-measured.
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
      // The top accent bar follows the tab's TOP edge, and the tab is a
      // parallelogram (clip-path shears TAB_SLANT off each end): its top edge
      // starts TAB_SLANT px to the right of its bottom edge. The bottom .ind
      // tracks the bottom edge (offsetLeft); the top bar must track the top
      // edge (offsetLeft + TAB_SLANT) or it reads as off-centre.
      top.style.transform = `translateX(${activeTab.offsetLeft + TAB_SLANT}px) scaleX(${scale})`;
    }

    moveIndicators();
    window.addEventListener("resize", moveIndicators);
    const observer = new MutationObserver(() => moveIndicators());
    observer.observe(bar, { attributes: true, attributeFilter: ["class"], subtree: true });
    return () => {
      window.removeEventListener("resize", moveIndicators);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="tabs" role="tablist" ref={barRef}>
      {children}
      <span className="ind" />
      <span className="top-ind" />
    </div>
  );
}
