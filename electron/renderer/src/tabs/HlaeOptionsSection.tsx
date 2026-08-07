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
  { key: "hlae_afx_stream", label: "AFX Stream" },
  { key: "hlae_no_spectator_ui", label: "No spectator UI" },
  { key: "hlae_fix_scope_fov", label: "Fix scope FOV" },
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
        {TOGGLE_FIELDS.map(({ key, label }) => (
          <ToggleField key={key} settingKey={key} label={label} />
        ))}
      </div>

      <SettingControl settingKey="hlae_extra_args">
        <Field
          id="hlae-extra-args"
          label="Additional HLAE args"
          value={extraArgs ?? ""}
          onChange={setExtraArgs}
        />
      </SettingControl>
    </div>
  );
}

function ToggleField({ settingKey, label }: { settingKey: string; label: string }) {
  const [value, setValue] = useSetting<boolean>(settingKey);
  return (
    <SettingControl settingKey={settingKey}>
      <Chip label={label} selected={!!value} onToggle={() => setValue(!value)} />
    </SettingControl>
  );
}
