/**
 * The run bar: RUN, PREVIEW, STOP, KILL, the progress line and the summary
 * line -- lifted from the window's `run_bar` (`csdm_batch_clips_generator.py`
 * around line 1041), which sat directly above the log panel in the same
 * column.
 *
 * D18, the one rule that matters in this file: each click sends exactly one
 * command and nothing else. No handler here may call an animation or
 * sequence function -- that mapping lives in `weapon/controller.ts`, which
 * reacts to the engine's own events, never to a click. Enabled/disabled state
 * is read straight from `useEngineState()`, never guessed from the click.
 */
import { type ReactNode, useCallback } from "react";

import { runCommand } from "../bridge";
import ActionButton from "../components/ActionButton";
import { ICONS } from "../icons";
import { useEngineState } from "../motion/useEngineState";
import { useAllSettings } from "../settings/store";
import type { TabSpec } from "./tabs";
import "./ActionBar.css";

export interface ActionBarProps {
  /**
   * Registers a button's element under an action name ("run" / "preview" /
   * "stop" / "kill"), the same names `weapon/controller.ts` uses to aim a
   * shot -- see `AppShell`'s `actionButtons` registry.
   */
  registerButton?: (action: string) => (element: HTMLElement | null) => void;
  /**
   * The weapon band. In the mock it is not a band of its own: it rides inside
   * the action bar as `.wband`, leading the row, with the buttons trailing.
   */
  weapon?: ReactNode;
  /**
   * The open tab. The editing tab swaps the capture actions for GENERATE /
   * SAVE / CANCEL, which read the preview selection instead of driving the
   * engine directly. Passed down from `AppShell`, which owns the tab state
   * (`useState` in AppShell.tsx, the same `active` that HudNav highlights).
   */
  active: TabSpec["id"];
  /** Switch tabs -- CANCEL uses it to return to the capture tab. */
  onSetTab: (tab: TabSpec["id"]) => void;
}

const noRegistration = () => () => {};

export default function ActionBar({
  registerButton = noRegistration,
  weapon,
  active,
  onSetTab,
}: ActionBarProps) {
  const engine = useEngineState();
  const settings = useAllSettings();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onRun = useCallback(() => {
    void runCommand("start_run", { cfg: settings });
  }, [settings]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onPreview = useCallback(() => {
    void runCommand("start_preview", { cfg: settings });
  }, [settings]);

  const onStop = useCallback(() => {
    void runCommand("request_stop");
  }, []);

  const onKill = useCallback(() => {
    void runCommand("request_kill");
  }, []);

  // The preview selection, in the snake_case shape the Python `_worker`
  // expects (the composite key `(demo_path, start_tick)` that addresses a
  // clip uniquely). Both GENERATE and SAVE send it; only GENERATE runs.
  const selectedClips = useCallback(
    () =>
      engine.previewClips
        .filter((clip) => clip.selected)
        .map((clip) => ({ demo_path: clip.demoPath, start_tick: clip.startTick })),
    [engine.previewClips],
  );

  const hasPreview = engine.previewClips.length > 0;
  const hasSelected = engine.previewClips.some((clip) => clip.selected);

  // GENERATE is the editing tab's primary: like RUN it starts a real run,
  // but restricted to the clips the user checked on the editing checklist.
  const onGenerate = useCallback(() => {
    void runCommand("start_run", { cfg: settings, selected_clips: selectedClips() });
  }, [settings, selectedClips]);

  // SAVE opens the same preset-save path PresetSection uses (`save_preset`),
  // carrying the current cfg and the selection that produced the preview.
  const onSave = useCallback(() => {
    void runCommand("save_preset", { cfg: settings, selected_clips: selectedClips() });
  }, [settings, selectedClips]);

  const onCancel = useCallback(() => {
    onSetTab("capture");
  }, [onSetTab]);

  const busy = engine.busy;

  // The editing tab swaps the whole capture action set: GENERATE / SAVE /
  // CANCEL replace RUN / PREVIEW / STOP / KILL. These are not registered with
  // the weapon controller (it only aims at run/preview/stop/kill), and none of
  // them keep the capture actions mounted, so the capture bar's own
  // registration refs simply stay null while editing is open.
  if (active === "editing") {
    return (
      <div className="actbar">
        {weapon}
        <span className="action-bar-btn">
          <ActionButton
            label="GENERATE"
            icon={<ICONS.run />}
            variant="run"
            disabled={!hasSelected || busy}
            title="Run only the clips checked below, not a full batch"
            data-action="Q1"
            onClick={onGenerate}
          />
        </span>
        <span className="action-bar-btn">
          <ActionButton
            label="SAVE"
            icon={<ICONS.presets />}
            variant="preview"
            disabled={!hasPreview || busy}
            title="Save the current settings and selection as a reusable preset"
            data-action="Q2"
            onClick={onSave}
          />
        </span>
        <span className="action-bar-btn">
          <ActionButton
            label="CANCEL"
            icon={<ICONS.editing />}
            variant="preview"
            title="Discard this preview and return to the Capture tab"
            data-action="Q3"
            onClick={onCancel}
          />
        </span>
      </div>
    );
  }

  return (
    <div className="actbar">
      {weapon}
      <span className="action-bar-btn" ref={registerButton("preview")}>
        <ActionButton
          label="PREVIEW"
          icon={<ICONS.preview />}
          variant="preview"
          title="Scan and list candidate clips for review, without recording video yet"
          data-action="A2"
          onClick={onPreview}
        />
      </span>
      <span className="action-bar-btn" ref={registerButton("stop")}>
        <ActionButton
          label={engine.stopLabel.toLowerCase().includes("preview") ? "STOP PREVIEW" : "STOP"}
          icon={<ICONS.stop />}
          variant="stop"
          disabled={!engine.stopEnabled}
          title="Ask the current run to stop gracefully after the in-progress clip"
          data-action="A3"
          onClick={onStop}
        />
      </span>
      <span className="action-bar-btn" ref={registerButton("kill")}>
        <ActionButton
          label="KILL"
          icon={<ICONS.kill />}
          variant="kill"
          disabled={!engine.killEnabled}
          title="Force-terminate the run immediately, without a clean shutdown"
          data-action="A4"
          onClick={onKill}
        />
      </span>
      <span className="action-bar-btn" ref={registerButton("run")}>
        <ActionButton
          label="RUN"
          icon={<ICONS.run />}
          variant="run"
          disabled={!engine.runEnabled}
          title="Start a full batch run using the current settings"
          data-action="A1"
          onClick={onRun}
        />
      </span>
    </div>
  );
}
