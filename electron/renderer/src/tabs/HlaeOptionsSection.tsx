/**
 * The HLAE OPTIONS section -- HLAE-exclusive settings.
 *
 * Ported from the `self._hlae_sec` block in `_tab_video`
 * (csdm_batch_clips_generator.py). `VideoTab` mounts this only while
 * `recsys` is HLAE (`_on_recsys_change`'s `is_hlae` branch): hiding it in CS
 * mode isn't cosmetic, the mirv_* commands it writes don't apply there.
 */
import Field from "../components/Field";
import Chip from "../components/Chip";
import SettingControl from "../settings/SettingControl";
import { useSetting } from "../settings/store";
import "./HlaeOptionsSection.css";

/** The Game Speed quick-value buttons, copied from the window's own row. */
const GAME_SPEED_QUICK_VALUES = ["50", "75", "100", "125", "150", "200", "500", "1000"] as const;

/** The three HLAE-only toggles, in the window's own order. */
const TOGGLE_FIELDS = [
  {
    key: "hlae_afx_stream",
    label: "AFX Stream",
    tip: "Records separate color/depth/stencil passes for compositing (HLAE AFX)",
  },
  {
    key: "hlae_no_spectator_ui",
    label: "No spectator UI",
    tip: "Hides the spectator HUD — injects +cl_draw_only_deathnotices 1",
  },
  {
    key: "hlae_fix_scope_fov",
    label: "Fix scope FOV",
    tip: "Stops scoped weapons overriding your FOV setting. Recommended: ON",
  },
] as const;

export default function HlaeOptionsSection() {
  const [fov, setFov] = useSetting<string | number>("hlae_fov");
  const [gameSpeed, setGameSpeed] = useSetting<string | number>("hlae_slow_motion");
  const [extraArgs, setExtraArgs] = useSetting<string>("hlae_extra_args");

  return (
    <div className="hlae-options">
      <span className="lab">HLAE options -- HLAE mode only</span>
      <p className="hlae-hint">
        Passed to HLAE via CSDM. Not available in CS recording mode. Audio captured directly by
        HLAE (bypasses Windows mixer).
      </p>

      <SettingControl settingKey="hlae_fov">
        <div className="row">
          <Field
            id="hlae-fov"
            label="FOV"
            mono
            value={fov === undefined || fov === null ? "90" : String(fov)}
            onChange={setFov}
          />
          <span className="hlae-desc">90 = default | 100-110 = cinematic wide | 60 = zoomed</span>
        </div>
      </SettingControl>

      <SettingControl settingKey="hlae_slow_motion">
        <div className="row">
          <Field
            id="hlae-game-speed"
            label="Game Speed (%)"
            mono
            value={gameSpeed === undefined || gameSpeed === null ? "100" : String(gameSpeed)}
            onChange={setGameSpeed}
            tip="Playback speed for recording: 100 = normal, below = slow motion, above = fast-forward"
          />
          <div className="row">
            {GAME_SPEED_QUICK_VALUES.map((quick) => (
              <button
                key={quick}
                type="button"
                className="chip"
                data-action="L6" onClick={() => setGameSpeed(quick)}
              >
                {quick}
              </button>
            ))}
          </div>
        </div>
      </SettingControl>

      <div className="row">
        {TOGGLE_FIELDS.map(({ key, label, tip }) => (
          <ToggleField key={key} settingKey={key} label={label} tip={tip} />
        ))}
      </div>

      <SettingControl settingKey="hlae_extra_args">
        <Field
          id="hlae-extra-args"
          label="Additional HLAE args"
          value={extraArgs ?? ""}
          onChange={setExtraArgs}
          tip="Extra command-line arguments passed directly to the HLAE launcher (advanced)"
        />
      </SettingControl>
    </div>
  );
}

function ToggleField({ settingKey, label, tip }: { settingKey: string; label: string; tip?: string }) {
  const [value, setValue] = useSetting<boolean>(settingKey);
  return (
    <SettingControl settingKey={settingKey}>
      <Chip label={label} tip={tip} selected={!!value} onToggle={() => setValue(!value)} />
    </SettingControl>
  );
}
