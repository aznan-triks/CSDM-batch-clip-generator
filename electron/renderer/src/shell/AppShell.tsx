import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { sendCommand } from "../bridge";
import Reticle from "../cursor/Reticle";
import ClickSpark from "../effects/ClickSpark";
import { ICONS } from "../icons";
import { useEngineState } from "../motion/useEngineState";
import { useWindowActivity } from "../motion/useWindowActivity";
import { useSetting } from "../settings/store";
import CaptureTab from "../tabs/CaptureTab";
import SettingsTab from "../tabs/SettingsTab";
import TagsTab from "../tabs/TagsTab";
import VideoTab from "../tabs/VideoTab";
import { applyAccent, resolveAccent } from "../theme/accent";
import { applyMode } from "../theme/mode";
import WeaponBand from "../weapon/WeaponBand";
import ActionBar from "./ActionBar";
import Backdrop from "./Backdrop";
import HudNav from "./HudNav";
import LogConsole from "./LogConsole";
import { clampSplitPct, SPLIT_PCT_DEFAULT } from "./splitPane";
import { TABS } from "./tabs";
import type { TabSpec } from "./tabs";
import "./AppShell.css";

/**
 * The application's frame: tabs in the top HudNav band, the tab panel and log
 * console below it, the action bar below that, and the weapon band across
 * the bottom.
 *
 * The tab panels are empty on purpose. This stage builds the shape; the 173
 * settings arrive in 4a.4 and 4b, one tab at a time, and the coverage test
 * counts what is still missing.
 */
export default function AppShell() {
  const [active, setActive] = useState<TabSpec["id"]>(TABS[0].id);
  const engine = useEngineState();

  // The backdrop and every sequence read the motion gate; this is what closes
  // it when CS2 takes the front during a run.
  useWindowActivity();

  // main.tsx applies the hardcoded defaults before first paint (the async
  // settings store hasn't loaded yet). This shell is mounted for the app's
  // whole life -- unlike SettingsTab, which only exists while that tab is
  // active -- so it is the one place that can re-apply the STORED theme as
  // soon as the store resolves, regardless of which tab the user has open.
  const [themeAccent] = useSetting<string>("theme_accent");
  const [themeBg] = useSetting<string>("theme_bg");
  // The nav's status pills (the mock's `.navtools`). Read here, not in HudNav:
  // HudNav is presentational and is rendered bare by its own tests.
  const [database] = useSetting<string>("pg_db");
  const [preset] = useSetting<string>("video_preset");

  // The console/content split (regression fix, AUDIT_console_resize_boutons.md):
  // `ui_split_pct` already existed as a typed field in Settings but drove
  // nothing -- this is the first thing that actually reads it to lay out the
  // shell. Percentage of the shell's own width the scrollwrap (content) gets;
  // the console gets the rest. Hard pixel floors live in AppShell.css
  // (`minmax(380px, …) … minmax(200px, …)`), matching the old Tkinter
  // window's `UI_PANE_LEFT_MIN`/`UI_PANE_RIGHT_MIN`.
  const [splitPct, setSplitPct] = useSetting<number>("ui_split_pct");
  const currentSplit = clampSplitPct(
    typeof splitPct === "number" && Number.isFinite(splitPct) ? splitPct : SPLIT_PCT_DEFAULT,
  );
  const shellRef = useRef<HTMLDivElement>(null);

  const startSplitDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const shell = shellRef.current;
      if (!shell) return;

      function onMove(moveEvent: MouseEvent) {
        const rect = shell!.getBoundingClientRect();
        const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        setSplitPct(clampSplitPct(pct));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setSplitPct],
  );

  useEffect(() => {
    // themeAccent may be a legacy Tkinter preset name ("green"), not always
    // hex -- see theme/accent.ts's resolveAccent doc comment.
    if (themeAccent) applyAccent(resolveAccent(themeAccent));
  }, [themeAccent]);

  useEffect(() => {
    if (themeBg) applyMode(themeBg);
  }, [themeBg]);

  // The open tab, on the document, so the backdrop can draw a different field
  // per screen (`BACKDROP_BY_TAB` in shell/backdropField.ts). An attribute
  // rather than a prop: the canvas is a sibling of `.app`, not a child of the
  // tab, and it already watches <html> for the theme.
  useEffect(() => {
    document.documentElement.setAttribute("data-tab", active);
  }, [active]);
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

  const hudTabs = TABS.map((tab) => {
    const Icon = ICONS[tab.icon];
    return { id: tab.id, label: tab.label, icon: <Icon /> };
  });

  return (
    <>
      {/* The mock's three ground layers, in its own order: the ambient wash,
          the holographic plate canvas, then the cursor. All three are siblings
          of `.app`, not children of it -- `.app` carries `z-index: 1` and
          lifts the whole interface off them in one move. The wash used to be
          baked into the shell's own `background`; it is its own layer here
          because that is where the mock puts it, and because a fixed layer
          keeps still while the workspace scrolls. */}
      <div className="amb" aria-hidden="true" />
      <Backdrop />
      <ClickSpark />
      <Reticle />
      <div className="app">
        <HudNav
          tabs={hudTabs}
          active={active}
          onSelect={setActive}
          database={database}
          preset={preset}
        />
        <div
          className="shell shell-resizable"
          ref={shellRef}
          style={
            {
              "--split-left": currentSplit,
              "--split-right": 100 - currentSplit,
            } as CSSProperties
          }
        >
          <div className="scrollwrap" role="tabpanel" aria-label={active}>
            {active === "capture" && <CaptureTab />}
            {active === "tags" && <TagsTab />}
            {active === "video" && <VideoTab />}
            {active === "settings" && <SettingsTab />}
          </div>
          <div
            className="split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize console"
            onMouseDown={startSplitDrag}
          />
          <LogConsole />
        </div>
        <ActionBar
          registerButton={registerButton}
          weapon={
            <WeaponBand
              status={engine.progress ?? (engine.busy ? "working…" : "idle")}
              counter={engine.summary?.text ?? ""}
              buttonRef={buttonRef}
            />
          }
        />
      </div>
    </>
  );
}
