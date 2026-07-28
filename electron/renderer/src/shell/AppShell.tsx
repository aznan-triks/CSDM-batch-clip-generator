import { useCallback, useRef, useState } from "react";

import { Tab, TabBar } from "../components/Tab";
import { ICONS } from "../icons";
import { useEngineState } from "../motion/useEngineState";
import WeaponBand from "../weapon/WeaponBand";
import LogConsole from "./LogConsole";
import { TABS } from "./tabs";
import type { TabSpec } from "./tabs";
import "./AppShell.css";

/**
 * The application's frame: tabs on the left, log console on the right, the
 * weapon band across the bottom.
 *
 * The tab panels are empty on purpose. This stage builds the shape; the 173
 * settings arrive in 4a.4 and 4b, one tab at a time, and the coverage test
 * counts what is still missing.
 */
export default function AppShell() {
  const [active, setActive] = useState<TabSpec["id"]>(TABS[0].id);
  const engine = useEngineState();
  // The action buttons a shot aims at, registered by name so the band never
  // has to know this file's markup.
  const actionButtons = useRef<Record<string, HTMLElement | null>>({});
  const buttonRef = useCallback((action: string) => actionButtons.current[action] ?? null, []);

  return (
    <div className="shell">
      <div className="shell-tabs">
        <TabBar>
          {TABS.map((tab) => {
            // Pulled out of the table BEFORE rendering: `ICONS[tab.icon]({})`
            // would call the function instead of mounting it, and React would
            // then see no component at all.
            const Icon = ICONS[tab.icon];
            return (
              <Tab
                key={tab.id}
                label={tab.label}
                icon={<Icon />}
                active={tab.id === active}
                onSelect={() => setActive(tab.id)}
              />
            );
          })}
        </TabBar>
        <div className="shell-panel" role="tabpanel" aria-label={active}>
          {/* Empty until 4a.4 and 4b port the controls. */}
        </div>
      </div>

      <LogConsole />

      <WeaponBand
        status={engine.progress ?? (engine.busy ? "working…" : "idle")}
        counter={engine.summary?.text ?? ""}
        buttonRef={buttonRef}
      />
    </div>
  );
}
