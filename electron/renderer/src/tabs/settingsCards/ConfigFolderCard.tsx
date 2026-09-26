/**
 * Configuration Folder (v3.0.1): where the four settings files live.
 *
 *   - timeline: the files' current home, and the three places they can be
 *     copied to, as destinations of one move;
 *   - sentence: "Keep my settings in <the app folder>.";
 *   - tiles: three pictures -- a USB stick, the user, a folder.
 *
 * Only the engine knows where the files really are (it resolves `config_dir`,
 * including the `appdata` sentinel), so the path shown is its answer to
 * `probe_config_dir`, never a guess. Switching COPIES the files, after one
 * confirmation -- or two, with a backup, when the target already has some.
 */
import { useEffect, useState, type ReactNode } from "react";

import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { pickPath, runCommand } from "../../bridge";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { useSetting } from "../../settings/store";
import { Glyph } from "./shared";
import "./SettingsCards.css";

type Kind = "app" | "appdata" | "custom";

/** What `probe_config_dir` reports about the active folder and a switch. */
interface FolderProbe {
  current: string;
  target: string;
  conflicts: string[];
  same: boolean;
  kind?: Kind;
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

interface Choice {
  kind: Kind;
  label: string;
  words: string;
  tip: string;
  glyph: "usb" | "home" | "folder";
}

const CHOICES: readonly Choice[] = [
  {
    kind: "app",
    label: "App folder (portable)",
    words: "the app's own folder",
    tip: "Stores settings next to the app itself -- portable, travels with the folder (e.g. USB drive)",
    glyph: "usb",
  },
  {
    kind: "appdata",
    label: "User Local AppData",
    words: "my Windows user folder",
    tip: "Stores settings in Windows' per-user AppData folder -- survives moving/reinstalling the app",
    glyph: "home",
  },
  {
    kind: "custom",
    label: "Choose…",
    words: "a folder I choose",
    tip: "Stores settings in a folder you pick",
    glyph: "folder",
  },
];

interface ConfigFolderModel {
  info: FolderProbe | null;
  error: string;
  pending: PendingSwitch | null;
  choose: (kind: Kind) => void;
  confirmOverwrite: () => void;
  cancel: () => void;
  apply: () => void;
}

/** The `config_dir` value of a fixed location ("" = the app folder). */
const VALUE: Record<Exclude<Kind, "custom">, string> = { app: "", appdata: "appdata" };

function useConfigFolder(): ConfigFolderModel {
  const [, setConfigDir] = useSetting<string>("config_dir");
  const [info, setInfo] = useState<FolderProbe | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingSwitch | null>(null);

  useEffect(() => {
    let cancelled = false;
    runCommand("probe_config_dir")
      .then((result) => {
        if (!cancelled) setInfo(result.data as FolderProbe);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function probe(value: string, label: string) {
    setError("");
    try {
      const result = await runCommand("probe_config_dir", { target: value });
      const p = result.data as FolderProbe;
      if (p.same) return; // already there; nothing to switch
      setPending({ value, label, targetDir: p.target, conflicts: p.conflicts, step: 1, busy: false });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function choose(kind: Kind) {
    if (kind === "custom") {
      const picked = await pickPath();
      if (picked !== null) await probe(picked, "Custom folder");
      return;
    }
    await probe(VALUE[kind], CHOICES.find((c) => c.kind === kind)!.label);
  }

  async function apply() {
    if (!pending) return;
    setPending({ ...pending, busy: true });
    try {
      const result = await runCommand("apply_config_dir", { target: pending.value });
      // The engine now reads and writes from the new folder. Update the store
      // so the debounced auto-save writes there too (and never reverts the
      // pointer with the pre-switch config_dir).
      setConfigDir(pending.value);
      setInfo(result.data as FolderProbe);
    } catch (cause) {
      setError((cause as Error).message);
    }
    setPending(null);
  }

  return {
    info,
    error,
    pending,
    choose: (kind) => void choose(kind),
    confirmOverwrite: () => setPending((p) => (p ? { ...p, step: 2 } : p)),
    cancel: () => setPending(null),
    apply: () => void apply(),
  };
}

/** One location as a button: the inventory markers live here, once. */
function LocationButton({ m, c, className, children }: { m: ConfigFolderModel; c: Choice; className?: string; children?: ReactNode }) {
  const active = m.info?.kind === c.kind;
  const base = className ?? "chip";
  return (
    <button
      type="button"
      className={active ? `${base} on` : base}
      aria-pressed={active}
      aria-label={c.label}
      data-action={c.kind === "app" ? "M13" : c.kind === "appdata" ? "M14" : "M15"}
      disabled={!!m.pending}
      title={c.tip}
      onClick={() => m.choose(c.kind)}
    >
      {children ?? c.label}
    </button>
  );
}

/** The confirmation(s) a switch waits on. */
function Confirm({ m }: { m: ConfigFolderModel }) {
  const p = m.pending;
  if (!p) return null;
  if (p.conflicts.length === 0) {
    return (
      <div className="settings-folder-confirm" role="alertdialog" aria-label="Copy config folder">
        <p>
          Copy the settings files to <b>{p.targetDir}</b>?
        </p>
        <div className="row">
          <button type="button" className="chip" onClick={m.apply} disabled={p.busy}>
            Copy
          </button>
          <button type="button" className="chip" onClick={m.cancel} disabled={p.busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (p.step === 1) {
    return (
      <div className="settings-folder-confirm" role="alertdialog" aria-label="Existing files">
        <p>
          These files already exist in <b>{p.targetDir}</b>: {p.conflicts.join(", ")}. Copying would overwrite them.
        </p>
        <div className="row">
          <button type="button" className="chip" onClick={m.confirmOverwrite}>
            Continue
          </button>
          <button type="button" className="chip" onClick={m.cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-folder-confirm settings-folder-danger" role="alertdialog" aria-label="Confirm overwrite">
      <p>
        <b>Really overwrite?</b> The existing files are first backed up in a &quot;backup-…&quot; subfolder, then replaced by
        the current ones.
      </p>
      <div className="row">
        <button type="button" className="chip" onClick={m.apply} disabled={p.busy}>
          Overwrite &amp; copy
        </button>
        <button type="button" className="chip" onClick={m.cancel} disabled={p.busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Current({ m }: { m: ConfigFolderModel }) {
  return <code className="settings-folder-path">{m.info ? m.info.current : "…"}</code>;
}

function Footer({ m }: { m: ConfigFolderModel }) {
  return (
    <>
      <p className="settings-hint">
        The four settings files (config, presets, players, assembly names) live in a &quot;CSDM Batch Clip Generator&quot;
        subfolder of the selected location. Switching COPIES them there — the current files always stay in place.
      </p>
      {m.error && <p className="settings-folder-error">{m.error}</p>}
      <Confirm m={m} />
    </>
  );
}

function TimelineView({ m }: { m: ConfigFolderModel }) {
  return (
    <SettingControl settingKey="config_dir">
      <div className="cfg-a settings-folder">
        <div className="cfg-move">
          <div className="cfg-from">
            <span className="sx-kick">Settings live in</span>
            <Current m={m} />
          </div>
          <span className="cfg-arrow" aria-hidden="true">
            copy to →
          </span>
          <div className="cfg-to">
            {CHOICES.map((c) => (
              <LocationButton key={c.kind} m={m} c={c} className="cfg-dest">
                <span className="st-ic">
                  <Glyph g={c.glyph} />
                </span>
                {c.label}
              </LocationButton>
            ))}
          </div>
        </div>
        <Footer m={m} />
      </div>
    </SettingControl>
  );
}

function SentenceView({ m }: { m: ConfigFolderModel }) {
  const now = CHOICES.find((c) => c.kind === m.info?.kind);
  return (
    <SettingControl settingKey="config_dir">
      <div className="cfg-b settings-folder">
        <div className="sc-prose">
          <div className="sc-line">
            <span className="w">Keep my settings in</span>{" "}
            <ChoiceToken
              label="Configuration folder"
              tip="Where the settings files live"
              popover={
                <>
                  <h5>Copy the settings to</h5>
                  <div className="sx-opts">
                    {CHOICES.map((c) => (
                      <LocationButton key={c.kind} m={m} c={c} className="sx-opt">
                        <span>
                          {c.words}
                          <small>{c.label}</small>
                        </span>
                      </LocationButton>
                    ))}
                  </div>
                </>
              }
            >
              {now ? now.words : "…"}
            </ChoiceToken>
            <span className="w">, that is</span> <Current m={m} />
            <span className="w">.</span>
          </div>
        </div>
        <Footer m={m} />
      </div>
    </SettingControl>
  );
}

function TilesView({ m }: { m: ConfigFolderModel }) {
  return (
    <SettingControl settingKey="config_dir">
      <div className="cfg-c settings-folder">
        <div className="cfg-tiles">
          {CHOICES.map((c) => (
            <LocationButton key={c.kind} m={m} c={c} className="cfg-tile">
              <span className="cfg-tile-art">
                <Glyph g={c.glyph} />
              </span>
              <b>{c.label}</b>
              <small>{c.words}</small>
            </LocationButton>
          ))}
        </div>
        <div className="cfg-from">
          <span className="sx-kick">Now</span>
          <Current m={m} />
        </div>
        <Footer m={m} />
      </div>
    </SettingControl>
  );
}

const VIEWS: CardViews<ConfigFolderModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function ConfigFolderCard(grid: GridProps) {
  const m = useConfigFolder();
  return <StyledCard cardId="config-folder" title="Configuration Folder" icon={<ICONS.paths />} prefix="cfg" m={m} views={VIEWS} grid={grid} />;
}
