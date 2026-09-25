/**
 * The Weapon Filter card's ONE data model.
 *
 * `weapons` is ONE list config key ("empty = all"), not one boolean per
 * weapon. The weapons offered are the ones in BOTH the connected database
 * (`connect_db`) and the engine's own category table
 * (`tables.weaponCategories`): the table lists every weapon CS2 ever shipped,
 * and offering one this database never recorded a kill with would let the
 * user pick a filter that always matches nothing.
 *
 * Every style draws this model; the silhouettes are the game's own art
 * (`weapon/silhouettes`), sized from each icon's own proportions.
 */
import { useState } from "react";

import { useDatabase } from "../../settings/useDatabase";
import { useSetting } from "../../settings/store";
import { useTables } from "../../settings/useTables";
import { silhouetteFor, silhouetteRatio } from "../../weapon/silhouettes";

/**
 * Silhouette geometry: every icon gets the same HEIGHT and a WIDTH from the
 * weapon's own viewBox ratio, bounded so a HE grenade stays readable and an
 * AWP does not dominate the row (reported 2026-08-03).
 */
export const GUN_HEIGHT = 44;
const GUN_MIN_WIDTH = 28;
const GUN_MAX_WIDTH = 150;

/** Seconds the fade-out of a deselected silhouette lasts; mirrors CSS. */
const FADE_SECONDS = 0.25;

/** Width in px for one silhouette at `height`, from its own viewBox ratio. */
export function gunWidth(name: string, height = GUN_HEIGHT): number {
  const ratio = silhouetteRatio(name);
  if (ratio == null) return Math.round((96 * height) / GUN_HEIGHT);
  const scale = height / GUN_HEIGHT;
  return Math.round(Math.min(GUN_MAX_WIDTH * scale, Math.max(GUN_MIN_WIDTH * scale, height * ratio)));
}

export interface WeaponModel {
  name: string;
  category: string;
  on: boolean;
  /** The game's icon as a data URI, or null when the pack has none. */
  art: string | null;
  tip: string;
  toggle: () => void;
}

export interface WeaponCategoryModel {
  name: string;
  tip: string;
  weapons: WeaponModel[];
  picked: number;
  /** Pick every weapon of the category, or drop them all when all are picked. */
  toggleAll: () => void;
}

export interface WeaponFilterModel {
  state: "loading" | "pending" | "ready";
  key: "weapons";
  categories: WeaponCategoryModel[];
  selected: string[];
  selectAll: { tip: string; run: () => void };
  deselectAll: { tip: string; run: () => void };
  /** The picked weapons' silhouettes, plus the ones fading out. */
  cascade: { name: string; art: string; leaving: boolean }[];
  /** "any weapon" / "AK-47, AWP & 2 more". */
  summary: string;
  count: string;
}

export function weaponSummary(selected: readonly string[], max = 3): string {
  if (!selected.length) return "any weapon";
  if (selected.length <= max) {
    return selected.length === 1 ? selected[0] : `${selected.slice(0, -1).join(", ")} & ${selected[selected.length - 1]}`;
  }
  return `${selected.slice(0, max - 1).join(", ")} & ${selected.length - (max - 1)} more`;
}

export function useWeaponFilter(): WeaponFilterModel {
  const { tables } = useTables();
  const { database } = useDatabase();
  const [weapons, setWeapons] = useSetting<string[]>("weapons");
  // Weapons being faded out: still drawn, already removed from `weapons`.
  const [leaving, setLeaving] = useState<string[]>([]);

  const selected = Array.isArray(weapons) ? weapons : [];
  const present = new Set(database?.weapons ?? []);
  const available = Object.entries(tables?.weaponCategories ?? {})
    .map(([category, names]) => [category, names.filter((n) => present.has(n))] as const)
    .filter(([, names]) => names.length > 0);
  const allWeapons = available.flatMap(([, names]) => names);

  function fadeOut(names: string[]) {
    if (!names.length) return;
    setLeaving((prev) => [...prev.filter((n) => !names.includes(n)), ...names]);
    window.setTimeout(() => setLeaving((prev) => prev.filter((n) => !names.includes(n))), FADE_SECONDS * 1000);
  }

  function remove(names: string[]) {
    setWeapons(selected.filter((w) => !names.includes(w)));
    fadeOut(names.filter((n) => selected.includes(n)));
  }

  function add(names: string[]) {
    setWeapons([...selected, ...names.filter((n) => !selected.includes(n))]);
    // A re-pick during the fade-out cancels it.
    setLeaving((prev) => prev.filter((n) => !names.includes(n)));
  }

  const categories: WeaponCategoryModel[] = available.map(([category, names]) => {
    const picked = names.filter((n) => selected.includes(n)).length;
    return {
      name: category,
      tip: tables?.weaponCategoryTips?.[category] ?? category,
      picked,
      toggleAll: () => (picked === names.length ? remove([...names]) : add([...names])),
      weapons: names.map((name) => {
        const on = selected.includes(name);
        return {
          name,
          category,
          on,
          art: silhouetteFor(name),
          tip: `Filter clips with ${name}`,
          toggle: () => (on ? remove([name]) : add([name])),
        };
      }),
    };
  });

  // EVERY picked weapon gets a silhouette: `silhouetteFor` falls back to the
  // weapon's class, so no pick is indistinguishable from a lost click.
  const art = (name: string) => silhouetteFor(name);
  const cascade = [
    ...selected.map((name) => ({ name, art: art(name), leaving: false })),
    ...leaving.filter((n) => !selected.includes(n)).map((name) => ({ name, art: art(name), leaving: true })),
  ].filter((e): e is { name: string; art: string; leaving: boolean } => e.art != null);

  return {
    state: !tables ? "loading" : !database ? "pending" : "ready",
    key: "weapons",
    categories,
    selected,
    selectAll: {
      tip: "Select all available weapons",
      run: () => {
        setWeapons([...allWeapons]);
        setLeaving([]);
      },
    },
    deselectAll: {
      tip: "Clear weapon selection",
      run: () => {
        const shown = selected.filter((w) => allWeapons.includes(w));
        if (shown.length === 0) return;
        setWeapons([]);
        fadeOut(shown);
      },
    },
    cascade,
    summary: weaponSummary(selected),
    count: selected.length ? `${selected.length} active` : "all",
  };
}
