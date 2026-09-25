/**
 * The shape shared by the two "pick some of a list" CAPTURE cards (Match
 * Types, Map Filter): a master switch and a list of options that only apply
 * while it is on. Each card builds this from its own keys in its own hook;
 * the generic views (sentence, tiles) draw it without knowing which card.
 *
 * The master switch never hides the options: the engine only SKIPS the filter
 * when it is off, it never removes the choice, so a hidden list would read as
 * a filter that does not exist. The options stay on screen, greyed.
 */
import type { ComponentType, ReactNode } from "react";

export interface SetOption {
  id: string;
  /** The config key this option writes (a list key is shared by every option). */
  settingKey: string;
  name: string;
  /** A small picture: an emoji, a monogram. */
  badge: ReactNode;
  /** One short line under the name on a tile. */
  detail: string;
  tip: string;
  on: boolean;
  toggle: () => void;
}

export interface SetFilterModel {
  /** Names for the sentence: "match type" / "match types", "map" / "maps". */
  noun: { one: string; many: string };
  enabled: { key: string; on: boolean; tip: string; toggle: () => void };
  /** What the filter keeps when it is on and nothing is picked. */
  emptyMeans: string;
  /**
   * Set when every option writes ONE list key (the map filter): the whole list
   * wears one setting wrapper instead of one per option.
   */
  listKey: string | null;
  options: SetOption[];
  /** Options drawn but inert: no database yet, or the switch is off. */
  locked: boolean;
  /** What to show instead of (or under) the options while data is missing. */
  pending: ReactNode | null;
  /** Wraps each option with the card's action marker (one marker, one file). */
  Mark: ComponentType<{ children: ReactNode }>;
}

/** "Premier, Competitive & Wingman", or the empty meaning. */
export function pickedWords(m: SetFilterModel, max = 3): string {
  const picked = m.options.filter((o) => o.on).map((o) => o.name);
  if (!picked.length) return m.emptyMeans;
  if (picked.length > max) return `${picked.slice(0, max - 1).join(", ")} & ${picked.length - max + 1} more`;
  return picked.length === 1 ? picked[0] : `${picked.slice(0, -1).join(", ")} & ${picked[picked.length - 1]}`;
}
