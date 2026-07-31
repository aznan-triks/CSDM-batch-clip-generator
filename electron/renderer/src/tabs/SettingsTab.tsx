/**
 * The Settings tab: PATHS, UI THEME, UI LAYOUT, POSTGRESQL CONNECTION,
 * PERFORMANCE and INJECTION PREVIEW.
 *
 * Ported from `_tab_outils` in csdm_batch_clips_generator.py. Both theme keys
 * are ported: `theme_accent` drives `--gold` (the only colour the user owns),
 * and `theme_bg` now selects the day/night ground -- it went from "no control
 * by design" to a real control when the restyle brought the two palettes back.
 *
 * `PresetSection` (chantier 4d tâche 4) ports the preset save/load/delete
 * block the window's PATHS tab also carried.
 */
import { useState } from "react";

import Card from "../components/Card";
import { ICONS } from "../icons";
import Chip from "../components/Chip";
import Field from "../components/Field";
import PathField from "../components/PathField";
import Segmented from "../components/Segmented";
import Slider from "../components/Slider";
import { runCommand } from "../bridge";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { ACCENT_PRESETS, applyAccent, resolveAccent } from "../theme/accent";
import { applyMode, DEFAULT_GROUND, GROUND_MODES } from "../theme/mode";
import PresetSection from "./PresetSection";
import "./SettingsTab.css";

/** Mirrors `_clamp_layout_values` in csdm_batch_clips_generator.py. */
function clampLayout(w: number, h: number, split: number): [number, number, number] {
  const width = Math.max(1000, Math.min(3840, Math.round(w) || 1600));
  const height = Math.max(600, Math.min(2160, Math.round(h) || 900));
  const pct = Math.max(38, Math.min(80, Math.round(split) || 60));
  return [width, height, pct];
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The grounds, taken from the mapping table so a value added there cannot be
 * missing from the control. Shown as the raw config values -- they are the same
 * names the window used, and prettier labels would mean teaching Segmented
 * about label/value pairs, which is a component change of its own.
 */
const GROUND_OPTIONS: readonly string[] = Object.keys(GROUND_MODES);

export default function SettingsTab() {
  const setMany = useSettingsBatch();

  const [csdmExe, setCsdmExe] = useSetting<string>("csdm_exe");
  const [cs2CfgDir, setCs2CfgDir] = useSetting<string>("cs2_cfg_dir");
  const [outputClips, setOutputClips] = useSetting<string>("output_dir_clips");
  const [outputConcat, setOutputConcat] = useSetting<string>("output_dir_concat");
  const [outputAssembled, setOutputAssembled] = useSetting<string>("output_dir_assembled");
  const [subfolderPerDemo, setSubfolderPerDemo] = useSetting<boolean>("subfolder_per_demo");

  const [themeAccent, setThemeAccent] = useSetting<string>("theme_accent");
  const [themeBg, setThemeBg] = useSetting<string>("theme_bg");

  // The stored theme is re-applied once, at boot, by a `useEffect` in
  // `AppShell.tsx` -- that shell is mounted for the app's whole life, unlike
  // this tab, which only exists while "settings" is the active tab. This file
  // still calls `applyAccent`/`applyMode` directly on user interaction below
  // (`chooseAccent`/`chooseGround`), which is the immediate-feedback path, not
  // the boot-time re-apply.

  const [windowW, setWindowW] = useSetting<number>("ui_window_w");
  const [windowH, setWindowH] = useSetting<number>("ui_window_h");
  const [splitPct, setSplitPct] = useSetting<number>("ui_split_pct");
  const [rememberLayout, setRememberLayout] = useSetting<boolean>("ui_remember_layout");

  const [pgHost, setPgHost] = useSetting<string>("pg_host");
  const [pgPort, setPgPort] = useSetting<string>("pg_port");
  const [pgUser, setPgUser] = useSetting<string>("pg_user");
  const [pgPass, setPgPass] = useSetting<string>("pg_pass");
  const [pgDb, setPgDb] = useSetting<string>("pg_db");
  const [dbStatus, setDbStatus] = useState("");

  const [dp2Threads, setDp2Threads] = useSetting<number>("dp2_threads");

  const currentW = asNumber(windowW, 1600);
  const currentH = asNumber(windowH, 900);
  const currentSplit = asNumber(splitPct, 60);
  // themeAccent may be a legacy Tkinter preset name ("green"), not always
  // hex -- see theme/accent.ts's resolveAccent doc comment.
  const currentAccent = resolveAccent(themeAccent ?? ACCENT_PRESETS[0].hex);

  function chooseAccent(hex: string) {
    setThemeAccent(hex);
    applyAccent(hex);
  }

  function chooseGround(ground: string) {
    setThemeBg(ground);
    applyMode(ground);
  }

  function applyLayout() {
    const [w, h, split] = clampLayout(currentW, currentH, currentSplit);
    setMany({ ui_window_w: w, ui_window_h: h, ui_split_pct: split });
  }

  function autoLayout() {
    const sw = typeof window !== "undefined" ? window.screen.width : 1920;
    const sh = typeof window !== "undefined" ? window.screen.height : 1080;
    const [w, h, split] = clampLayout(Math.round(sw * 0.86), Math.round(sh * 0.84), 60);
    setMany({ ui_window_w: w, ui_window_h: h, ui_split_pct: split });
  }

  function resetLayoutDefaults() {
    setMany({ ui_window_w: 1600, ui_window_h: 900, ui_split_pct: 60 });
  }

  async function testAndReload() {
    setDbStatus("Connecting…");
    try {
      await runCommand("connect_db", {
        pg: { host: pgHost, port: pgPort, user: pgUser, pass: pgPass, db: pgDb },
      });
      setDbStatus("Connected");
    } catch (cause) {
      setDbStatus((cause as Error).message);
    }
  }

  return (
    <div className="bento settings-tab">
      <Card title="Paths" icon={<ICONS.paths />} className="wide">
        <SettingControl settingKey="csdm_exe">
          <PathField
            id="csdm-exe"
            label="CSDM Executable"
            placeholder="csdm.CMD or csdm.exe"
            value={csdmExe ?? ""}
            onChange={setCsdmExe}
            mode="file"
          />
        </SettingControl>
        <SettingControl settingKey="cs2_cfg_dir">
          <PathField
            id="cs2-cfg-dir"
            label="CS2 cfg folder"
            placeholder="Optional override (…\Counter-Strike Global Offensive\game\csgo\cfg)"
            value={cs2CfgDir ?? ""}
            onChange={setCs2CfgDir}
            mode="dir"
          />
        </SettingControl>
        <SettingControl settingKey="output_dir_clips">
          <PathField
            id="output-dir-clips"
            label="Raw clips folder"
            placeholder="A subfolder per demo is created here"
            value={outputClips ?? ""}
            onChange={setOutputClips}
            mode="dir"
          />
        </SettingControl>
        <SettingControl settingKey="output_dir_concat">
          <PathField
            id="output-dir-concat"
            label="Concatenated clips folder"
            placeholder="Empty = same folder as raw clips"
            value={outputConcat ?? ""}
            onChange={setOutputConcat}
            mode="dir"
          />
        </SettingControl>
        <SettingControl settingKey="output_dir_assembled">
          <PathField
            id="output-dir-assembled"
            label="Assembled file folder"
            placeholder="Empty = same folder as raw clips"
            value={outputAssembled ?? ""}
            onChange={setOutputAssembled}
            mode="dir"
          />
        </SettingControl>
        <SettingControl settingKey="subfolder_per_demo">
          <Chip
            label="Subfolder per demo"
            selected={!!subfolderPerDemo}
            onToggle={() => setSubfolderPerDemo(!subfolderPerDemo)}
          />
        </SettingControl>
      </Card>

      <PresetSection />

      <Card title="UI Theme" icon={<ICONS.uiTheme />}>
        <SettingControl settingKey="theme_accent">
          <div className="settings-accent">
            <span className="lab">Accent</span>
            <div className="row" role="radiogroup" aria-label="Accent">
              {ACCENT_PRESETS.map((preset) => {
                const selected = preset.hex.toLowerCase() === currentAccent.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? "settings-swatch settings-swatch-selected" : "settings-swatch"}
                    style={{ backgroundColor: preset.hex }}
                    onClick={() => chooseAccent(preset.hex)}
                  >
                    <span className="settings-swatch-label">{preset.name}</span>
                  </button>
                );
              })}
              <label className="settings-swatch-custom">
                <span>Custom…</span>
                <input
                  type="color"
                  value={currentAccent}
                  onChange={(event) => chooseAccent(event.target.value)}
                />
              </label>
            </div>
          </div>
        </SettingControl>
        <SettingControl settingKey="theme_bg">
          <div className="row">
            <span className="lab">Mode</span>
            <Segmented
              options={GROUND_OPTIONS}
              value={themeBg ?? DEFAULT_GROUND}
              onChange={chooseGround}
              label="Ground"
            />
          </div>
        </SettingControl>
      </Card>

      <Card title="UI Layout" icon={<ICONS.uiLayout />}>
        <div className="row">
          <SettingControl settingKey="ui_window_w">
            <Field
              id="ui-window-w"
              label="Window width"
              mono
              value={String(currentW)}
              onChange={(v) => setWindowW(asNumber(v, currentW))}
            />
          </SettingControl>
          <SettingControl settingKey="ui_window_h">
            <Field
              id="ui-window-h"
              label="Window height"
              mono
              value={String(currentH)}
              onChange={(v) => setWindowH(asNumber(v, currentH))}
            />
          </SettingControl>
          <SettingControl settingKey="ui_split_pct">
            <Field
              id="ui-split-pct"
              label="Split %"
              mono
              value={String(currentSplit)}
              onChange={(v) => setSplitPct(asNumber(v, currentSplit))}
            />
          </SettingControl>
        </div>
        <div className="row">
          <button type="button" className="chip" onClick={applyLayout}>
            Apply
          </button>
          <button type="button" className="chip" onClick={autoLayout}>
            Auto
          </button>
          <button
            type="button"
            className="chip"
            onClick={resetLayoutDefaults}
          >
            Reset default
          </button>
          <SettingControl settingKey="ui_remember_layout">
            <Chip
              label="Remember current layout"
              selected={!!rememberLayout}
              onToggle={() => setRememberLayout(!rememberLayout)}
            />
          </SettingControl>
        </div>
      </Card>

      <Card title="PostgreSQL Connection" icon={<ICONS.postgresql />} className="wide">
        <div className="row">
          <SettingControl settingKey="pg_host">
            <Field id="pg-host" label="Host" value={pgHost ?? ""} onChange={setPgHost} />
          </SettingControl>
          <SettingControl settingKey="pg_port">
            <Field id="pg-port" label="Port" value={pgPort ?? ""} onChange={setPgPort} />
          </SettingControl>
          <SettingControl settingKey="pg_db">
            <Field id="pg-db" label="Base" value={pgDb ?? ""} onChange={setPgDb} />
          </SettingControl>
          <SettingControl settingKey="pg_user">
            <Field id="pg-user" label="User" value={pgUser ?? ""} onChange={setPgUser} />
          </SettingControl>
          <SettingControl settingKey="pg_pass">
            <Field
              id="pg-pass"
              label="Pass"
              type="password"
              value={pgPass ?? ""}
              onChange={setPgPass}
            />
          </SettingControl>
        </div>
        <div className="row">
          <button type="button" className="chip" onClick={testAndReload}>
            Test & Reload
          </button>
          {dbStatus && <span className="settings-db-status">{dbStatus}</span>}
        </div>
      </Card>

      <Card title="Performance" icon={<ICONS.performance />}>
        <SettingControl settingKey="dp2_threads">
          <Slider
            id="dp2-threads"
            label="DP2 parse threads"
            min={1}
            max={8}
            value={asNumber(dp2Threads, 4)}
            onChange={setDp2Threads}
            readout={String(asNumber(dp2Threads, 4))}
          />
        </SettingControl>
        <p className="settings-hint">
          Number of parallel threads used to pre-parse demo files with demoparser2 (TROIS SHOT /
          ONE TAP / TROIS TAP filters). Higher = faster pre-parse on multi-core CPUs. Set to 1 to
          disable.
        </p>
      </Card>

      <Card title="Injection Preview" icon={<ICONS.injectionPreview />}>
        <p className="settings-hint">
          Live preview of the args injected into CS2 for the current configuration.
        </p>
        {/* No bridge command currently returns the injection preview text
            (`_refresh_injection_preview` never left the Tkinter process); a
            placeholder replaces it rather than reimplementing that engine
            logic here. See task-3-report.md for the documented gap. */}
        <pre className="settings-injection-preview">not available yet</pre>
        <button type="button" className="chip" disabled>
          ⟳ Refresh
        </button>
      </Card>
    </div>
  );
}
