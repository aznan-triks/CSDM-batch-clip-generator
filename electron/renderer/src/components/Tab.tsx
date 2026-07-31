import { useLayoutEffect, useRef, type ReactNode } from "react";

import "./Tab.css";

interface TabProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onSelect: () => void;
}

/**
 * One tab, extracted from the mock's `.tab` (mockup-v12-hologlass.html).
 *
 * `role="tab"`, not a bare button: a card header is a button too, and once
 * the cards got fold toggles, "CAPTURE" the tab and "Capture & Timing" the
 * card became two buttons matching the same name. The tab role is both the
 * correct ARIA for a strip that switches a `tabpanel` and the thing that
 * keeps the two apart -- for a screen reader as much as for a test.
 */
export function Tab({ label, icon, active, onSelect }: TabProps) {
  const classes = active ? "tab active" : "tab";
  return (
    <button
      type="button"
      role="tab"
      className={classes}
      onClick={onSelect}
      aria-selected={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
    >
      {icon}
      {/* The mock's `.tk`: a small diamond tick between glyph and label. It
          lights up on the open tab -- part of how the strip reads as a HUD
          rather than a row of words. */}
      <span className="tk" aria-hidden="true" />
      {label}
    </button>
  );
}

interface TabBarProps {
  children: ReactNode;
}

/**
 * The two numbers the indicator's arithmetic needs, and both belong to the
 * approved mock, not to this file: `.tab`'s clip-path shears 18px off each
 * end, and `.ind` is a 100px bar the transform scales (mock-v12.css). They are
 * read here rather than re-decided -- change them in the mock and this follows.
 */
const TAB_SLANT = 18; // mock: .tab{clip-path:polygon(18px 0,...)}
const IND_BASE_WIDTH = 100; // mock: .ind{width:100px}

/**
 * Row layout for a set of `Tab`s (mock `.tabs`), plus the sliding `.ind`
 * underline (mock `moveInd`, mockup-v12-hologlass.html) that always sits under
 * whichever child carries `.active`.
 */
export function TabBar({ children }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    function moveIndicator() {
      const bar = barRef.current;
      const ind = indRef.current;
      if (!bar || !ind) return;
      const activeTab = bar.querySelector<HTMLElement>(".tab.active");
      if (!activeTab) return;
      const scale = (activeTab.offsetWidth - TAB_SLANT) / IND_BASE_WIDTH;
      ind.style.transform = `translateX(${activeTab.offsetLeft}px) scaleX(${scale})`;
    }

    moveIndicator();
    window.addEventListener("resize", moveIndicator);
    return () => window.removeEventListener("resize", moveIndicator);
  });

  return (
    <div className="tabs" role="tablist" ref={barRef}>
      {children}
      <span className="ind" ref={indRef} />
    </div>
  );
}
