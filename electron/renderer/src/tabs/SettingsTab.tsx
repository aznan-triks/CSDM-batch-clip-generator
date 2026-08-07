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
import { useEffect, useState } from "react";

import Card from "../components/Card";
import { ICONS } from "../icons";
import Chip from "../components/Chip";
import Field from "../components/Field";
import PathField from "../components/PathField";
import Segmented from "../components/Segmented";
import Slider from "../components/Slider";
import { pickPath, runCommand } from "../bridge";
import SectionList, { type SectionSpec } from "../shell/SectionList";
import SettingControl from "../settings/SettingControl";
import { useSetting, useSettingsBatch } from "../settings/store";
import { ACCENT_PRESETS, applyAccent, resolveAccent } from "../theme/accent";
import { applyMode, DEFAULT_GROUND, GROUND_MODES } from "../theme/mode";
import PresetSection from "./PresetSection";
import { clampSplitPct } from "../shell/splitPane";
import "./SettingsTab.css";

/** Mirrors `_clamp_layout_values` in csdm_batch_clips_generator.py. */
function clampLayout(w: number, h: number, split: number): [number, number, number] {
  const width = Math.max(1000, Math.min(3840, Math.round(w) || 1600));
  const height = Math.max(600, Math.min(2160, Math.round(h) || 900));
  return [width, height, clampSplitPct(split)];
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

/** What `probe_config_dir` reports about the active folder and a switch. */
interface FolderProbe {
  current: string;
  target: string;
  conflicts: string[];
  same: boolean;
  /** Which location is active: "app" (script subfolder), "appdata" or "custom". */
  kind?: "app" | "appdata" | "custom";
}

/** The `kind` a `config_dir` value resolves to -- mirrors the engine's answer. */
function choiceKind(value: string): FolderProbe["kind"] {
  if (value === "") return "app";
  if (value === "appdata") return "appdata";
  return "custom";
}

/** A folder switch waiting on the user's confirmation(s). */
interface PendingSwitch {
  value: string;
  label: string;
  targetDir: string;
  conflicts: string[];
  /** 1 = files exist, first warning; 2 = confirm overwrite with backup. */
  step: 1 | 2;
  busy: boolean;
}

/** The two fixed locations; the third (Choose…) resolves a path at click time. */
const FOLDER_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "App folder (portable)" },
  { value: "appdata", label: "User Local AppData" },
];

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

  // Configuration folder (v3.0.1): the active location plus a pending switch.
  const [, setConfigDir] = useSetting<string>("config_dir");
  const [folderInfo, setFolderInfo] = useState<FolderProbe | null>(null);
  const [folderError, setFolderError] = useState("");
  const [pending, setPending] = useState<PendingSwitch | null>(null);

  // Ask the engine where the settings files actually live. The engine is the
  // only side that knows (it resolves config_dir, including the appdata
  // sentinel and the custom subfolder), so the path shown is never guessed.
  useEffect(() => {
    let cancelled = false;
    runCommand("probe_config_dir")
      .then((result) => {
        if (!cancelled) setFolderInfo(result.data as FolderProbe);
      })
      .catch((cause: Error) => {
        if (!cancelled) setFolderError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseFolder(value: string, label: string) {
    setFolderError("");
    try {
      const result = await runCommand("probe_config_dir", { target: value });
      const probe = result.data as FolderProbe;
      if (probe.same) return; // already there; nothing to switch
      setPending({
        value,
        label,
        targetDir: probe.target,
        conflicts: probe.conflicts,
        step: 1,
        busy: false,
      });
    } catch (cause) {
      setFolderError((cause as Error).message);
    }
  }

  async function chooseCustomFolder() {
    const picked = await pickPath();
    if (picked !== null) await chooseFolder(picked, "Custom folder");
  }

  function confirmOverwrite() {
    setPending((previous) => (previous ? { ...previous, step: 2 } : previous));
  }

  function cancelSwitch() {
    setPending(null);
  }

  async function applySwitch() {
    if (!pending) return;
    setPending({ ...pending, busy: true });
    try {
      const result = await runCommand("apply_config_dir", { target: pending.value });
      // The engine now reads and writes from the new folder. Update the store
      // so the debounced auto-save writes there too (and never reverts the
      // pointer with the pre-switch config_dir).
      setConfigDir(pending.value);
      setFolderInfo(result.data as FolderProbe);
      setPending(null);
    } catch (cause) {
      setFolderError((cause as Error).message);
      setPending(null);
    }
  }

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

  const SECTIONS: SectionSpec[] = [
    {
      id: "postgresql",
      element: (
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
            <button type="button" className="chip" data-action="M10" onClick={testAndReload}>
              Test & Reload
            </button>
            {dbStatus && <span className="settings-db-status">{dbStatus}</span>}
          </div>
        </Card>
      ),
    },
    {
      id: "paths",
      element: (
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
      ),
    },
    {
      id: "config-folder",
      element: (
        <Card title="Configuration Folder" icon={<ICONS.paths />} className="wide">
          <SettingControl settingKey="config_dir">
            <div className="settings-folder">
              <div className="settings-folder-current">
                <span className="lab">Location</span>
                <code className="settings-folder-path">{folderInfo ? folderInfo.current : "…"}</code>
              </div>
              <div className="row">
                {FOLDER_CHOICES.map((choice) => {
                  const active = folderInfo?.kind === choiceKind(choice.value);
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      className={active ? "chip on" : "chip"}
                      aria-pressed={active}
                      data-action={choice.value === "" ? "M13" : "M14"}
                      disabled={!!pending}
                      onClick={() => chooseFolder(choice.value, choice.label)}
                    >
                      {choice.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={folderInfo?.kind === "custom" ? "chip on" : "chip"}
                  aria-pressed={folderInfo?.kind === "custom"}
                  data-action="M15"
                  disabled={!!pending}
                  onClick={chooseCustomFolder}
                >
                  Choose…
                </button>
              </div>
              <p className="settings-hint">
                The four settings files (config, presets, players, assembly names) live in a
                &quot;CSDM Batch Clip Generator&quot; subfolder of the selected location. Switching
                COPIES them there — the current files always stay in place.
              </p>
              {folderError && <p className="settings-folder-error">{folderError}</p>}
              {pending && pending.conflicts.length === 0 && (
                <div className="settings-folder-confirm" role="alertdialog" aria-label="Copy config folder">
                  <p>
                    Copy the settings files to <b>{pending.targetDir}</b>?
                  </p>
                  <div className="row">
                    <button type="button" className="chip" onClick={applySwitch} disabled={pending.busy}>
                      Copy
                    </button>
                    <button type="button" className="chip" onClick={cancelSwitch} disabled={pending.busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {pending && pending.conflicts.length > 0 && pending.step === 1 && (
                <div className="settings-folder-confirm" role="alertdialog" aria-label="Existing files">
                  <p>
                    These files already exist in <b>{pending.targetDir}</b>:{" "}
                    {pending.conflicts.join(", ")}. Copying would overwrite them.
                  </p>
                  <div className="row">
                    <button type="button" className="chip" onClick={confirmOverwrite}>
                      Continue
                    </button>
                    <button type="button" className="chip" onClick={cancelSwitch}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {pending && pending.conflicts.length > 0 && pending.step === 2 && (
                <div className="settings-folder-confirm settings-folder-danger" role="alertdialog" aria-label="Confirm overwrite">
                  <p>
                    <b>Really overwrite?</b> The existing files are first backed up in a
                    &quot;backup-…&quot; subfolder, then replaced by the current ones.
                  </p>
                  <div className="row">
                    <button type="button" className="chip" onClick={applySwitch} disabled={pending.busy}>
                      Overwrite &amp; copy
                    </button>
                    <button type="button" className="chip" onClick={cancelSwitch} disabled={pending.busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SettingControl>
        </Card>
      ),
    },
    { id: "presets", element: <PresetSection /> },
    {
      id: "ui-theme",
      element: (
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
      ),
    },
    {
      id: "ui-layout",
      element: (
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
            <button type="button" className="chip" data-action="M5" onClick={applyLayout}>
              Apply
            </button>
            <button type="button" className="chip" data-action="M6" onClick={autoLayout}>
              Auto
            </button>
            <button type="button" className="chip" data-action="M7" onClick={resetLayoutDefaults}>
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
      ),
    },
    {
      id: "performance",
      element: (
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
      ),
    },
    {
      id: "injection-preview",
      element: (
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
      ),
    },
  ];

  return (
    <div className="bento settings-tab">
      <SectionList tabId="settings" sections={SECTIONS} />
    </div>
  );
}
