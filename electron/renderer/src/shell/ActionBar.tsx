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
import { useCallback } from "react";

import { runCommand } from "../bridge";
import ActionButton from "../components/ActionButton";
import { ICONS } from "../icons";
import { useEngineState } from "../motion/useEngineState";
import { useAllSettings } from "../settings/store";
import "./ActionBar.css";

export interface ActionBarProps {
  /**
   * Registers a button's element under an action name ("run" / "preview" /
   * "stop" / "kill"), the same names `weapon/controller.ts` uses to aim a
   * shot -- see `AppShell`'s `actionButtons` registry.
   */
  registerButton?: (action: string) => (element: HTMLElement | null) => void;
}

const noRegistration = () => () => {};

export default function ActionBar({ registerButton = noRegistration }: ActionBarProps) {
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

  return (
    <div className="action-bar">
      <div className="action-bar-row">
        <span className="action-bar-btn" ref={registerButton("run")}>
          <ActionButton
            label="RUN"
            icon={<ICONS.run />}
            variant="run"
            disabled={!engine.runEnabled}
            onClick={onRun}
          />
        </span>
        <span className="action-bar-sep" />
        <span className="action-bar-btn" ref={registerButton("preview")}>
          <ActionButton
            label="PREVIEW"
            icon={<ICONS.preview />}
            variant="preview"
            onClick={onPreview}
          />
        </span>
        <span className="action-bar-sep" />
        <span className="action-bar-btn" ref={registerButton("stop")}>
          <ActionButton
            label={engine.stopLabel.toLowerCase().includes("preview") ? "STOP PREVIEW" : "STOP"}
            icon={<ICONS.stop />}
            variant="stop"
            disabled={!engine.stopEnabled}
            onClick={onStop}
          />
        </span>
        <span className="action-bar-btn" ref={registerButton("kill")}>
          <ActionButton
            label="KILL"
            icon={<ICONS.kill />}
            variant="kill"
            disabled={!engine.killEnabled}
            onClick={onKill}
          />
        </span>

        <div className="action-bar-progress">{engine.progress}</div>
      </div>

      <div className="action-bar-summary">{engine.summary?.text}</div>
    </div>
  );
}
