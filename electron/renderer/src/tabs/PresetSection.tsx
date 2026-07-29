/**
 * The preset save/load/delete block, ported from the PATHS tab's own preset
 * row in `_tab_outils` (csdm_batch_clips_generator.py).
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

import Card from "../components/Card";
import Field from "../components/Field";
import Chip from "../components/Chip";
import { runCommand } from "../bridge";
import { useAllSettings, useSettingsBatch } from "../settings/store";
import { useTables } from "../settings/useTables";
import "./PresetSection.css";

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

export default function PresetSection() {
  const { tables } = useTables();
  const categories = tables?.presetCategories ?? [];
  const settings = useAllSettings();
  const setMany = useSettingsBatch();

  const [name, setName] = useState("");
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<PresetsMap>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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

  function toggleCat(key: string) {
    setSelectedCats((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setError("");
    setStatus("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("This preset needs a name.");
      return;
    }
    const cats = [...selectedCats];
    if (cats.length === 0) {
      setError("Select at least one category to include.");
      return;
    }
    try {
      const result = await runCommand("save_preset", { preset: trimmed, cats, cfg: settings });
      setPresets((result.data ?? {}) as PresetsMap);
      setStatus(`Saved "${trimmed}".`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function load(presetName: string) {
    setError("");
    setStatus("");
    try {
      const result = await runCommand("load_preset", { preset: presetName });
      const data = (result.data ?? {}) as Record<string, unknown>;
      const keys = (result.keys as string[] | null | undefined) ?? null;
      const written = keys === null ? data : Object.fromEntries(keys.map((k) => [k, data[k]]));
      setMany(written);
      setStatus(`Loaded "${presetName}".`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function remove(presetName: string) {
    setError("");
    setStatus("");
    try {
      const result = await runCommand("delete_preset", { preset: presetName });
      setPresets((result.data ?? {}) as PresetsMap);
      setStatus(`Deleted "${presetName}".`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Card title="PRESETS">
      <Field id="preset-name" label="Name" value={name} onChange={setName} placeholder="Preset name" />

      <div className="preset-categories" role="group" aria-label="Categories">
        {categories.map((key) => (
          <Chip
            key={key}
            label={categoryLabel(key)}
            selected={selectedCats.has(key)}
            onToggle={() => toggleCat(key)}
          />
        ))}
      </div>

      <div className="preset-actions">
        <button type="button" className="preset-btn preset-btn-primary" onClick={save}>
          SAVE
        </button>
        {error && <span className="preset-message preset-message-error">{error}</span>}
        {!error && status && <span className="preset-message preset-message-ok">{status}</span>}
      </div>

      <ul className="preset-list">
        {Object.keys(presets).length === 0 && <li className="preset-empty">No saved presets.</li>}
        {Object.entries(presets).map(([presetName, preset]) => (
          <li key={presetName} className="preset-row">
            <span className="preset-row-name">{presetName}</span>
            <span className="preset-row-cats">{preset.cats.join(", ")}</span>
            <button type="button" className="preset-btn" onClick={() => load(presetName)}>
              Load
            </button>
            <button
              type="button"
              className="preset-btn preset-btn-delete"
              onClick={() => remove(presetName)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
