/**
 * The preset save/load/delete card, ported from the PATHS tab's own preset
 * row in `_tab_outils` (csdm_batch_clips_generator.py), drawn in its card
 * style:
 *
 *   - timeline: a "save" lane (name, what to include, SAVE) over the shelf of
 *     saved presets;
 *   - sentence: "Save <these settings> as <name>." and one line per preset;
 *   - tiles: one tile per saved preset and a tile to save a new one.
 *
 * Category checkboxes come from `useTables()`'s `presetCategories` --
 * `describe_filters`'s `preset_categories` on the Python side
 * (`csdm/bridge/tables.py`), which sends "full" plus the tab-grouped
 * categories (`_PRESET_ALL_CATS` in `csdm/config.py`) -- the same list the
 * original Tkinter preset dialog rendered as checkboxes. `PRESET_KEYS` also
 * carries two backward-compat aliases, "player" and "video", for reading old
 * preset files; those were never shown as checkboxes and are deliberately
 * left out here. A hand-typed category list here would drift the day Python
 * adds or renames one (D20 / R1).
 *
 * `load_preset` returns `{ data, keys }`: `keys` is the list of configuration
 * keys this preset may overwrite (`null` for a "full" preset, which then
 * writes every key `data` carries). Writing `data` wholesale regardless of
 * `keys` would let a "date" preset silently replace the entire configuration
 * -- exactly the bug `preset_payload` (`csdm/config.py`) exists to prevent.
 */
import { useEffect, useState } from "react";

import ConfirmDialog from "../components/ConfirmDialog";
import Chip from "../components/Chip";
import Field from "../components/Field";
import StyledCard, { type CardViews } from "../components/cardstyle/StyledCard";
import { BigTile } from "../components/cardstyle/StyledParts";
import { ChoiceToken } from "../components/cardstyle/SentenceToken";
import type { GridProps } from "../components/cardstyle/gridProps";
import { runCommand } from "../bridge";
import { ICONS } from "../icons";
import { useAllSettings, useSettingsBatch } from "../settings/store";
import { useTables } from "../settings/useTables";
import { Glyph } from "./settingsCards/shared";
import "./PresetSection.css";
import "./settingsCards/SettingsCards.css";

/** One stored preset, the shape `list_presets`/`save_preset`/`delete_preset` return. */
interface StoredPreset {
  cats: string[];
  data: Record<string, unknown>;
}

type PresetsMap = Record<string, StoredPreset>;

/** Turns a `PRESET_KEYS` key into a readable label without inventing meaning Python doesn't send. */
function categoryLabel(key: string): string {
  if (key === "full") return "Full config";
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface PresetsModel {
  name: string;
  setName: (value: string) => void;
  categories: readonly string[];
  isIncluded: (cat: string) => boolean;
  toggleCat: (cat: string) => void;
  save: () => void;
  presets: PresetsMap;
  load: (name: string) => void;
  askDelete: (name: string) => void;
  pendingDelete: string | null;
  cancelDelete: () => void;
  confirmDelete: () => void;
  error: string;
  status: string;
}

function usePresets(): PresetsModel {
  const { tables } = useTables();
  const settings = useAllSettings();
  const setMany = useSettingsBatch();

  const [name, setName] = useState("");
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<PresetsMap>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runCommand("list_presets")
      .then((result) => {
        if (!cancelled) setPresets((result.data ?? {}) as PresetsMap);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Run one bridge call with the message slots cleared first. */
  async function run(work: () => Promise<void>) {
    setError("");
    setStatus("");
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("");
      return setError("This preset needs a name.");
    }
    const cats = [...selectedCats];
    if (cats.length === 0) {
      setStatus("");
      return setError("Select at least one category to include.");
    }
    void run(async () => {
      const result = await runCommand("save_preset", { preset: trimmed, cats, cfg: settings });
      setPresets((result.data ?? {}) as PresetsMap);
      setStatus(`Saved "${trimmed}".`);
    });
  }

  return {
    name,
    setName,
    categories: tables?.presetCategories ?? [],
    isIncluded: (cat) => selectedCats.has(cat),
    toggleCat: (cat) =>
      setSelectedCats((previous) => {
        const next = new Set(previous);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        return next;
      }),
    save,
    presets,
    load: (presetName) =>
      void run(async () => {
        const result = await runCommand("load_preset", { preset: presetName });
        const data = (result.data ?? {}) as Record<string, unknown>;
        const keys = (result.keys as string[] | null | undefined) ?? null;
        setMany(keys === null ? data : Object.fromEntries(keys.map((k) => [k, data[k]])));
        setStatus(`Loaded "${presetName}".`);
      }),
    askDelete: setPendingDelete,
    pendingDelete,
    cancelDelete: () => setPendingDelete(null),
    confirmDelete: () => {
      const presetName = pendingDelete;
      setPendingDelete(null);
      if (presetName === null) return;
      void run(async () => {
        const result = await runCommand("delete_preset", { preset: presetName });
        setPresets((result.data ?? {}) as PresetsMap);
        setStatus(`Deleted "${presetName}".`);
      });
    },
    error,
    status,
  };
}

/* ---- the marked controls, written once ---- */

function SaveButton({ m, className }: { m: PresetsModel; className?: string }) {
  return (
    <button type="button" className={className ?? "chip"} data-action="C3" title="Save selected settings categories to this preset" onClick={m.save}>
      SAVE
    </button>
  );
}

function LoadButton({ m, preset }: { m: PresetsModel; preset: string }) {
  return (
    <button
      type="button"
      className="chip"
      title="Load this preset, overwriting only the settings it was saved with"
      data-action="C4"
      onClick={() => m.load(preset)}
    >
      Load
    </button>
  );
}

function DeleteButton({ m, preset }: { m: PresetsModel; preset: string }) {
  return (
    <button type="button" className="chip danger" title="Permanently remove this preset" data-action="C5" onClick={() => m.askDelete(preset)}>
      Delete
    </button>
  );
}

function Message({ m }: { m: PresetsModel }) {
  if (m.error) return <span className="preset-message preset-message-error">{m.error}</span>;
  if (m.status)
    return (
      <span className="preset-message preset-message-ok" data-action="P10">
        {m.status}
      </span>
    );
  return null;
}

function NameBox({ m, label = "Name" }: { m: PresetsModel; label?: string }) {
  return (
    <Field id="preset-name" label={label} value={m.name} onChange={m.setName} placeholder="Preset name" tip="Identifier name for this configuration preset" />
  );
}

function Categories({ m }: { m: PresetsModel }) {
  return (
    <div className="row" role="group" aria-label="Categories" title="Choose which settings groups this preset saves and can later overwrite">
      {m.categories.map((key) => (
        <Chip
          key={key}
          label={categoryLabel(key)}
          tip={`Include ${categoryLabel(key)} settings in this preset`}
          selected={m.isIncluded(key)}
          onToggle={() => m.toggleCat(key)}
        />
      ))}
    </div>
  );
}

function PresetList({ m }: { m: PresetsModel }) {
  const names = Object.keys(m.presets);
  return (
    <ul className="preset-list">
      {names.length === 0 && <li className="preset-empty">No saved presets.</li>}
      {Object.entries(m.presets).map(([presetName, preset]) => (
        <li key={presetName} className="preset-row">
          <span className="preset-row-name">{presetName}</span>
          <span className="preset-row-cats">{(preset.cats ?? []).map(categoryLabel).join(", ")}</span>
          <LoadButton m={m} preset={presetName} />
          <DeleteButton m={m} preset={presetName} />
        </li>
      ))}
    </ul>
  );
}

function TimelineView({ m }: { m: PresetsModel }) {
  return (
    <div className="ps-a">
      <div className="ps-lane">
        <span className="sx-kick">Save the current settings</span>
        <NameBox m={m} />
        <Categories m={m} />
        <div className="row">
          <SaveButton m={m} className="chip on" />
          <Message m={m} />
        </div>
      </div>
      <span className="sx-kick">Saved</span>
      <PresetList m={m} />
    </div>
  );
}

function includedWords(m: PresetsModel): string {
  const on = m.categories.filter((c) => m.isIncluded(c)).map(categoryLabel);
  if (on.length === 0) return "which settings?";
  return on.length <= 2 ? on.join(" and ") : `${on.slice(0, 2).join(", ")} +${on.length - 2}`;
}

function SentenceView({ m }: { m: PresetsModel }) {
  return (
    <div className="ps-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Save</span>{" "}
          <ChoiceToken
            label="Categories"
            tip="Choose which settings groups this preset saves and can later overwrite"
            popover={
              <>
                <h5>What the preset keeps</h5>
                <Categories m={m} />
              </>
            }
          >
            {includedWords(m)}
          </ChoiceToken>{" "}
          <span className="w">as</span>{" "}
          <span className="ps-name">
            <NameBox m={m} label="" />
          </span>{" "}
          <SaveButton m={m} className="sx-act" />
        </div>
      </div>
      <Message m={m} />
      <PresetList m={m} />
    </div>
  );
}

function TilesView({ m }: { m: PresetsModel }) {
  return (
    <div className="ps-c">
      <div className="sx-tiles">
        <BigTile icon={<Glyph g="save" />} title="New preset" wide>
          <NameBox m={m} label="" />
          <Categories m={m} />
          <SaveButton m={m} className="chip on" />
          <Message m={m} />
        </BigTile>
        {Object.entries(m.presets).map(([presetName, preset]) => (
          <BigTile key={presetName} icon={<Glyph g="load" />} title={presetName} caption={(preset.cats ?? []).map(categoryLabel).join(", ")} tone="alt">
            <LoadButton m={m} preset={presetName} />
            <DeleteButton m={m} preset={presetName} />
          </BigTile>
        ))}
      </div>
      {Object.keys(m.presets).length === 0 && <p className="preset-empty">No saved presets.</p>}
    </div>
  );
}

const VIEWS: CardViews<PresetsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function PresetSection(grid: GridProps = {}) {
  const m = usePresets();
  return (
    <StyledCard
      cardId="presets"
      title="Presets"
      icon={<ICONS.presets />}
      prefix="ps"
      m={m}
      views={VIEWS}
      grid={grid}
      count={`${Object.keys(m.presets).length} saved`}
    >
      {m.pendingDelete !== null && (
        <ConfirmDialog
          title="Delete preset"
          message={`Delete preset "${m.pendingDelete}"? This cannot be undone.`}
          onCancel={m.cancelDelete}
          onConfirm={m.confirmDelete}
          danger
        />
      )}
    </StyledCard>
  );
}
