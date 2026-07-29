import { useCallback, useEffect, useRef, useState } from "react";

import { sendCommand } from "../bridge";
import { Tab, TabBar } from "../components/Tab";
import { ICONS } from "../icons";
import { useEngineState } from "../motion/useEngineState";
import CaptureTab from "../tabs/CaptureTab";
import SettingsTab from "../tabs/SettingsTab";
import TagsTab from "../tabs/TagsTab";
import VideoTab from "../tabs/VideoTab";
import WeaponBand from "../weapon/WeaponBand";
import ActionBar from "./ActionBar";
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
  const registerButton = useCallback(
    (action: string) => (element: HTMLElement | null) => {
      actionButtons.current[action] = element;
    },
    [],
  );

  // Ask the engine to introduce itself. It volunteers nothing at start-up, so
  // without this the console holds a single bare `[result]` line and reads as
  // a window talking to a dead engine.
  //
  // `sendCommand`, not `runCommand`: the answer that matters is the banner on
  // the log socket, which the console already renders. There is nothing here
  // to await and nothing to do if it fails -- a dead engine reports itself
  // through `child_exit`.
  //
  // Effects run child-first, so LogConsole has subscribed before this fires.
  useEffect(() => {
    sendCommand("hello");
  }, []);

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
          {active === "capture" && <CaptureTab />}
          {active === "tags" && <TagsTab />}
          {active === "video" && <VideoTab />}
          {active === "settings" && <SettingsTab />}
        </div>
      </div>

      <div className="shell-log-column">
        <ActionBar registerButton={registerButton} />
        <LogConsole />
      </div>

      <WeaponBand
        status={engine.progress ?? (engine.busy ? "working…" : "idle")}
        counter={engine.summary?.text ?? ""}
        buttonRef={buttonRef}
      />
    </div>
  );
}
